import { LoginNeeded } from './login-stuff.js'
import { loadSettings } from './settings-loader.js'

const settings = loadSettings()
export const loginProfiles = settings.loginProfiles.map((user) => new LoginNeeded(user))
