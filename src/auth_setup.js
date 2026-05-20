import 'dotenv/config'
import fs from 'fs'
import { google } from 'googleapis'
import readline from 'readline'

const GAUTH_PATH = '.gauth.json'

// Load credentials
if (!fs.existsSync(GAUTH_PATH)) {
  console.error(`Missing ${GAUTH_PATH} file.`)
  process.exit(1)
}

const gauth = JSON.parse(fs.readFileSync(GAUTH_PATH, 'utf8'))
const { client_id, client_secret, redirect_uris } = gauth.web
const redirect_uri = redirect_uris[0] || 'http://localhost:4100/code'

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uri
)

// Required scopes for Drive (creating docs) and Gmail (sending emails)
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send'
]

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Forces consent screen to ensure we get a refresh token
})

console.log('=== Google API Authorization ===')
console.log('1. Go to this URL in your browser:\n')
console.log(authUrl)
console.log('\n2. Authorize the app and you will be redirected.')
console.log(`3. The redirect URL will look like: ${redirect_uri}?code=YOUR_CODE_HERE&...`)
console.log('4. Copy the YOUR_CODE_HERE part and paste it below.\n')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

rl.question('Enter the code from that page here: ', async (code) => {
  rl.close()
  try {
    const { tokens } = await oauth2Client.getToken(code)
    console.log('\n=== SUCCESS ===')
    console.log('Add the following line to your .env file:\n')
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('\nAlso, ensure these are in your .env or GitHub Secrets for deployment:')
    console.log(`GOOGLE_CLIENT_ID=${client_id}`)
    console.log(`GOOGLE_CLIENT_SECRET=${client_secret}`)
  } catch (error) {
    console.error('Error retrieving access token', error.message)
  }
})
