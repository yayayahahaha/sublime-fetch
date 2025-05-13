import { LoginNeeded } from './login-stuff.js'

export const setting = [
  new LoginNeeded({
    pk: 'fc',
    // email: 'flyc.chung@btse.com',
    // email: 'fc@mailto.plus',
    email: 'fc1@mailto.plus',
    // email: 'fc2@mailto.plus',

    // brandName: 'traiex',
    brandName: 'lmex',
    // brandName: 'bitkub',
    password: '__PUT_YOUR_EMAIL_HERE',
    // secretCode2Fa: 'TBLGEDVCFKTNY7TH', // lmex
    // secretCode2Fa: 'LBNWTLGLIUKYJ2XJ', // traiex
    deviceFingerprint: 'my-finger-print-test-2',
  }),

  new LoginNeeded({
    pk: 'matoi',
    email: 'fc1@mailto.plus',
    // email: 'flyc.chung@btse.com',
    brandName: 'traiex',
    password: '__PUT_YOUR_EMAIL_HERE',
    // secretCode2Fa: 'LBNWTLGLIUKYJ2XJ', // traiex
    deviceFingerprint: 'my-finger-print-test-2',
  }),
]
