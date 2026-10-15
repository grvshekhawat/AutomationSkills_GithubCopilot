import { $ } from '@wdio/globals'
import Page from './page.js'

/**
 * Golden style example for generated WebdriverIO page objects.
 * Locators are always rooted at the configured test attribute.
 */
class LoginPage extends Page {
    get loginUsernameFieldInput () {
        return $('[test-automation-id="login-username-field"] input')
    }

    get loginPassword () {
        return $('[test-automation-id="login-password"]')
    }

    get loginSubmit () {
        return $('[test-automation-id="login-submit"]')
    }

    open () {
        return super.open('/login')
    }
}

export default new LoginPage()
