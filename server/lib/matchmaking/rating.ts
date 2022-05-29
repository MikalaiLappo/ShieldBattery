import { ReconciledPlayerResult, ReconciledResult } from '../../../common/games/results'
import {
  MatchmakingSeason,
  MATCHMAKING_BONUS_EARNED_PER_MS,
  MATCHMAKING_INACTIVE_TIME_MS,
  wasPlayerInactive,
} from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user'
import { NEW_PLAYER_GAME_COUNT } from './constants'
import { MatchmakingRating, MatchmakingRatingChange } from './models'

/**
 * Calculates a `MatchmakingRatingChange` for each user in a game. This function expects that every
 * player in `results` has a matching entry in `mmrs`.
 */
export function calculateChangedRatings({
  season,
  gameId,
  gameDate,
  results,
  mmrs: unadjustedMmrs,
  teams,
}: {
  /** The matchmaking season the game was played in. */
  season: MatchmakingSeason
  /** The ID of the game that was played. */
  gameId: string
  /** When the game was completed (and changed ratings were calculated). */
  gameDate: Date
  /**
   * The reconciled results of the game, with everyone having a win or a loss (e.g. not disputed
   * results).
   */
  results: Map<SbUserId, ReconciledPlayerResult>
  /** The current matchmaking rating info for the users, prior to playing the game. */
  mmrs: ReadonlyArray<Readonly<MatchmakingRating>>
  /** The player's user IDs split into their respective teams. */
  teams: [teamA: SbUserId[], teamB: SbUserId[]]
  // TODO(tec27): Pass in party information as well
}): Map<SbUserId, MatchmakingRatingChange> {
  const result = new Map<SbUserId, MatchmakingRatingChange>()

  const mmrs = unadjustedMmrs.map(m => adjustMatchmakingRatingForInactivity(m, gameDate))

  if (results.size === 2) {
    // 1v1
    result.set(
      mmrs[0].userId,
      makeRatingChange({
        season,
        gameId,
        gameDate,
        player: mmrs[0],
        opponentRating: mmrs[1].rating,
        opponentUncertainty: mmrs[1].uncertainty,
        result: results.get(mmrs[0].userId)!.result,
      }),
    )
    result.set(
      mmrs[1].userId,
      makeRatingChange({
        season,
        gameId,
        gameDate,
        player: mmrs[1],
        opponentRating: mmrs[0].rating,
        opponentUncertainty: mmrs[0].uncertainty,
        result: results.get(mmrs[1].userId)!.result,
      }),
    )
  } else {
    // Teams
    const [teamA, teamB] = teams
    const mmrById = mmrs.reduce((result, mmr) => {
      result.set(mmr.userId, mmr)
      return result
    }, new Map<SbUserId, MatchmakingRating>())

    const teamARatings = teamA.map(userId => mmrById.get(userId)!)
    const [teamAEffective, teamAUncertainty] = calcTeamRating(teamARatings)

    const teamBRatings = teamB.map(userId => mmrById.get(userId)!)
    const [teamBEffective, teamBUncertainty] = calcTeamRating(teamBRatings)

    // All players on team A get their rating adjusted based on the effective rating of team B
    for (const player of teamARatings) {
      result.set(
        player.userId,
        makeRatingChange({
          season,
          gameId,
          gameDate,
          player,
          opponentRating: teamBEffective,
          opponentUncertainty: teamBUncertainty,
          result: results.get(player.userId)!.result,
        }),
      )
    }

    // All players on team B get their rating adjusted based on the effective rating of team A
    for (const player of teamBRatings) {
      result.set(
        player.userId,
        makeRatingChange({
          season,
          gameId,
          gameDate,
          player,
          opponentRating: teamAEffective,
          opponentUncertainty: teamAUncertainty,
          result: results.get(player.userId)!.result,
        }),
      )
    }
  }

  return result
}

/**
 * Calculates the rating for a team as a whole, to be used as the "opponent" in team matches. Note
 * that this differs from the effective rating using during matchmaking because we want to ensure
 * that rating inflation doesn't occur.
 */
function calcTeamRating(
  ratings: ReadonlyArray<MatchmakingRating>,
): [rating: number, uncertainty: number] {
  const ratingSum = ratings.reduce((sum, rating) => sum + rating.rating, 0)
  const uncertaintySum = ratings.reduce((sum, rating) => sum + rating.uncertainty, 0)
  return [ratingSum / ratings.length, uncertaintySum / ratings.length]
}

const MAX_INCREASED_UNCERTAINTY = 200 / 173.7178

/**
 * Returns a MatchmakingRating that has had its value adjusted for how inactive the player has been.
 * If the player is not inactive, the return value will be the same as the input.
 */
export function adjustMatchmakingRatingForInactivity(
  mmr: Readonly<MatchmakingRating>,
  targetDate: Date,
): Readonly<MatchmakingRating> {
  if (!wasPlayerInactive(mmr.lastPlayedDate, targetDate)) {
    return mmr
  }

  let newUncertainty = mmr.uncertainty / 173.7178
  const periodsInactive = Math.floor(
    (Number(targetDate) - Number(mmr.lastPlayedDate)) / MATCHMAKING_INACTIVE_TIME_MS,
  )
  for (let i = 0; i < periodsInactive; i++) {
    const next = Math.sqrt(Math.pow(newUncertainty, 2) + Math.pow(mmr.volatility, 2))
    if (next > MAX_INCREASED_UNCERTAINTY) {
      newUncertainty = MAX_INCREASED_UNCERTAINTY
      break
    }

    newUncertainty = next
  }

  return {
    ...mmr,
    uncertainty: newUncertainty * 173.7178,
  }
}

const VOLATILITY_CHANGE = 0.5
const POINTS_ELO_K_FACTOR = 24
const MIN_UNCERTAINTY = 30

function makeRatingChange({
  season,
  gameId,
  gameDate,
  player,
  opponentRating: opponentRatingGlicko,
  opponentUncertainty: opponentUncertaintyGlicko,
  result,
}: {
  season: MatchmakingSeason
  gameId: string
  gameDate: Date
  player: MatchmakingRating
  opponentRating: number
  opponentUncertainty: number
  result: ReconciledResult
}): MatchmakingRatingChange {
  // Calculations are described here:
  // https://docs.google.com/document/d/1gHY9t3fe2qK2dwFjpVz6U2gaET-nc1iXhgMdOhcyDaE/view

  // 1) Convert from Glicko to Glicko-2 scale
  const selfRating = (player.rating - 1500) / 173.7178
  const selfUncertainty = player.uncertainty / 173.7178
  const selfVolatility = player.volatility
  const opponentRating = (opponentRatingGlicko - 1500) / 173.7178
  const opponentUncertainty = opponentUncertaintyGlicko / 173.7178
  // 2) Determine variance
  const opponentWeight =
    1 / Math.sqrt(1 + (3 * opponentUncertainty * opponentUncertainty) / (Math.PI * Math.PI))
  const expectedProbability = 1 / (1 + Math.exp(-opponentWeight * (selfRating - opponentRating)))

  const variance =
    1 / (opponentWeight * opponentWeight * expectedProbability * (1 - expectedProbability))
  // 3) Determine estimated improvement in rating
  const outcome = result === 'win' ? 1 : 0
  const estimatedImprovement = variance * opponentWeight * (outcome - expectedProbability)
  // 4) Update volatility
  // 4.1)
  const a = Math.log(selfVolatility * selfVolatility)
  const f = (x: number) =>
    (Math.exp(x) *
      (Math.pow(estimatedImprovement, 2) - Math.pow(selfUncertainty, 2) - variance - Math.exp(x))) /
      (2 * Math.pow(Math.pow(selfUncertainty, 2) + variance + Math.exp(x), 2)) -
    (x - a) / Math.pow(VOLATILITY_CHANGE, 2)
  const EPSILON = 0.000001

  // 4.2)
  let aValue = a
  let bValue: number
  if (Math.pow(estimatedImprovement, 2) > Math.pow(selfUncertainty, 2) + variance) {
    bValue = Math.log(Math.pow(estimatedImprovement, 2) - Math.pow(selfUncertainty, 2) - variance)
  } else {
    let k = 1
    while (f(a - k * VOLATILITY_CHANGE) < 0) {
      k += 1
    }
    bValue = a - k * VOLATILITY_CHANGE
  }

  // 4.3)
  let fA = f(aValue)
  let fB = f(bValue)

  // 4.4)
  while (Math.abs(bValue - aValue) > EPSILON) {
    const cValue = aValue + ((aValue - bValue) * fA) / (fB - fA)
    const fC = f(cValue)
    if (fC * fB < 0) {
      aValue = bValue
      fA = fB
    } else {
      fA = fA / 2
    }

    bValue = cValue
    fB = fC
  }
  // 4.5)
  const newVolatility = Math.exp(aValue / 2)
  // 5) Update RD to the new pre-rating period value
  const periodValue = Math.sqrt(Math.pow(selfUncertainty, 2) + Math.pow(newVolatility, 2))
  // 6.1) Update the RD and rating to new values
  let newUncertainty = 1 / Math.sqrt(1 / Math.pow(periodValue, 2) + 1 / variance)
  let newRating =
    selfRating + Math.pow(newUncertainty, 2) * opponentWeight * (outcome - expectedProbability)

  // 8) Convert ratings and RDs back to Glicko
  newRating = Math.max(173.7178 * newRating + 1500, 0)
  newUncertainty = Math.min(Math.max(173.7178 * newUncertainty, MIN_UNCERTAINTY), 350)

  // Calculate change in points
  const pointsWithoutBonus = Math.max(player.points - player.bonusUsed, 0)
  const winProbability =
    1 / (1 + Math.pow(10, (4 * opponentRatingGlicko - pointsWithoutBonus) / 1600))
  let pointsChange = 4 * POINTS_ELO_K_FACTOR * (outcome - winProbability)
  if (result === 'win' && pointsChange < 1) {
    pointsChange = 1
  }

  // Apply bonus pool
  const timeSinceSeasonStart = Number(gameDate) - Number(season.startDate)
  const bonusAvailable = Math.max(
    timeSinceSeasonStart * MATCHMAKING_BONUS_EARNED_PER_MS - player.bonusUsed,
    0,
  )
  // For wins, bonus pool can up to double the point improvement. For losses, bonus pool can offset
  // up to the entire amount of the point loss.
  const bonusApplied = Math.min(bonusAvailable, Math.abs(pointsChange))
  pointsChange = pointsChange + bonusApplied

  // Ensure that a player's points cannot go below 0
  pointsChange = Math.max(pointsChange, -player.points)

  return {
    userId: player.userId,
    matchmakingType: player.matchmakingType,
    gameId,
    changeDate: gameDate,
    outcome: result === 'win' ? 'win' : 'loss',
    rating: newRating,
    ratingChange: newRating - player.rating,
    kFactor: player.kFactor,
    kFactorChange: 0,
    uncertainty: newUncertainty,
    uncertaintyChange: newUncertainty - player.uncertainty,
    volatility: newVolatility,
    volatilityChange: newVolatility - player.volatility,
    points: player.points + pointsChange,
    pointsChange,
    bonusUsed: player.bonusUsed + bonusApplied,
    bonusUsedChange: bonusApplied,
    probability: expectedProbability,
    unexpectedStreak: 0,
  }
}

/**
 * Calculates a `MatchmakingRatingChange` for each user in a game. This function expects that every
 * player in `results` has a matching entry in `mmrs`.
 *
 * @deprecated Only use for calculating legacy ratings, will be deleted soon.
 */
export function legacyCalculateChangedRatings({
  gameId,
  gameDate,
  results,
  mmrs,
  teams,
}: {
  /** The ID of the game that was played. */
  gameId: string
  /** When the game was completed (and changed ratings were calculated). */
  gameDate: Date
  /**
   * The reconciled results of the game, with everyone having a win or a loss (e.g. not disputed
   * results).
   */
  results: Map<SbUserId, ReconciledPlayerResult>
  /** The current matchmaking rating info for the users, prior to playing the game. */
  mmrs: MatchmakingRating[]
  /** The player's user IDs split into their respective teams. */
  teams: [teamA: SbUserId[], teamB: SbUserId[]]
  // TODO(tec27): Pass in party information as well
}): Map<SbUserId, MatchmakingRatingChange> {
  const result = new Map<SbUserId, MatchmakingRatingChange>()

  if (results.size === 2) {
    // 1v1
    result.set(
      mmrs[0].userId,
      legacyMakeRatingChange({
        gameId,
        gameDate,
        player: mmrs[0],
        opponentRating: mmrs[1].rating,
        result: results.get(mmrs[0].userId)!.result,
      }),
    )
    result.set(
      mmrs[1].userId,
      legacyMakeRatingChange({
        gameId,
        gameDate,
        player: mmrs[1],
        opponentRating: mmrs[0].rating,
        result: results.get(mmrs[1].userId)!.result,
      }),
    )
  } else {
    // Teams
    const [teamA, teamB] = teams
    const mmrById = mmrs.reduce((result, mmr) => {
      result.set(mmr.userId, mmr)
      return result
    }, new Map<SbUserId, MatchmakingRating>())

    const teamARatings = teamA.map(userId => mmrById.get(userId)!)
    const [teamAEffective] = calcTeamRating(teamARatings)

    const teamBRatings = teamB.map(userId => mmrById.get(userId)!)
    const [teamBEffective] = calcTeamRating(teamBRatings)

    // All players on team A get their rating adjusted based on the effective rating of team B
    for (const player of teamARatings) {
      result.set(
        player.userId,
        legacyMakeRatingChange({
          gameId,
          gameDate,
          player,
          opponentRating: teamBEffective,
          result: results.get(player.userId)!.result,
        }),
      )
    }

    // All players on team B get their rating adjusted based on the effective rating of team A
    for (const player of teamBRatings) {
      result.set(
        player.userId,
        legacyMakeRatingChange({
          gameId,
          gameDate,
          player,
          opponentRating: teamAEffective,
          result: results.get(player.userId)!.result,
        }),
      )
    }
  }

  return result
}

/**
 * @deprecated Only use for calculating legacy ratings, will be deleted soon.
 */
function legacyMakeRatingChange({
  gameId,
  gameDate,
  player,
  opponentRating,
  result,
}: {
  gameId: string
  gameDate: Date
  player: MatchmakingRating
  opponentRating: number
  result: ReconciledResult
}): MatchmakingRatingChange {
  const ratingDiff = opponentRating - player.rating
  const p = 1 / (1 + Math.pow(10, ratingDiff / 400))
  const outcome = result === 'win' ? 1 : 0

  const newRating = Math.max(player.rating + player.kFactor * (outcome - p), 0)

  let newKFactor = player.kFactor
  if (player.numGamesPlayed >= NEW_PLAYER_GAME_COUNT) {
    if (outcome === 1 && p >= 0.5) {
      newKFactor -= p
    } else if (outcome === 0 && p < 0.5) {
      newKFactor -= 1 - p
    }
  }

  const unexpected = (outcome === 1 && p < 0.5) || (outcome === 0 && p >= 0.5)
  let newUnexpectedStreak = unexpected ? player.unexpectedStreak + 1 : 0
  if (newUnexpectedStreak > 2) {
    newUnexpectedStreak = 0
    newKFactor += 1
  }

  newKFactor = Math.max(Math.min(newKFactor, 40), 24)

  const uncertaintyChange = Math.abs(player.kFactor * (outcome - p))
  let newUncertainty = unexpected
    ? player.uncertainty + uncertaintyChange
    : player.uncertainty - uncertaintyChange

  newUncertainty = Math.max(Math.min(newUncertainty, 600), 80)

  return {
    userId: player.userId,
    matchmakingType: player.matchmakingType,
    gameId,
    changeDate: gameDate,
    outcome: result === 'win' ? 'win' : 'loss',
    rating: newRating,
    ratingChange: newRating - player.rating,
    kFactor: newKFactor,
    kFactorChange: newKFactor - player.kFactor,
    uncertainty: newUncertainty,
    uncertaintyChange: newUncertainty - player.uncertainty,
    volatility: player.volatility,
    volatilityChange: 0,
    points: newRating,
    pointsChange: newRating - player.rating,
    bonusUsed: 0,
    bonusUsedChange: 0,
    probability: p,
    unexpectedStreak: newUnexpectedStreak,
  }
}
