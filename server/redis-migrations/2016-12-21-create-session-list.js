import { container } from 'tsyringe'
import { Redis } from '../lib/redis'

const MIGRATION_NAME = '2016-12-21-create-session-list'

async function migrate() {
  const redis = container.resolve(Redis)
  const isMigrated = await redis.exists(`migrations:${MIGRATION_NAME}`)
  if (isMigrated) {
    return
  }

  const sessionKeys = await redis.keys('koa:sess:*')
  for (const sessionId of sessionKeys) {
    const session = JSON.parse(await redis.get(sessionId))
    if (session.userId !== undefined) {
      const userSessionsKey = 'user_sessions:' + session.userId
      await redis.sadd(userSessionsKey, sessionId)
      await redis.expire(userSessionsKey, Number(process.env.SB_SESSION_TTL))
    }
  }

  await redis.set(`migrations:${MIGRATION_NAME}`, 1)

  await redis.quit()
}

migrate()
  .then(() => {
    process.exit()
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
