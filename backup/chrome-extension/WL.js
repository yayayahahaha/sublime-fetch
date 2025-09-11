import { LoginNeeded } from './login-stuff.js'
import { loadSettings } from './settings-loader.js'

const settings = loadSettings()
export const setting = settings.users.map(user => new LoginNeeded(user))
