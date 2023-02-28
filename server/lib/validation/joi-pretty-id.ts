import Joi from 'joi'

/**
 * Returns a Joi validator that will check for a valid ID generated by `common/pretty-id`. Note this
 * will *not* convert the value, it will still be a string in pretty-id form.
 */
export function joiPrettyId() {
  return Joi.string()
    .length(22)
    .pattern(/^[A-Za-z0-9_-]+$/)
}
