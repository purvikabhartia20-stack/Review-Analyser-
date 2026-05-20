// src/phase4/phase4_deliver.js
// Phase 4 — Deliver fully autonomously using Google APIs

import 'dotenv/config'
import { google } from 'googleapis'

function getAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('[Phase 4] Missing Google Auth env variables. Make sure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN are set.')
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  )
  
  oauth2Client.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN
  })
  
  return oauth2Client
}

// Helper function to format the raw pulse text into beautiful HTML
function formatPulseTextForUI(rawText) {
  // 1. Remove the first 5 lines (the raw text header)
  let clean = rawText.split('\n').slice(5).join('\n')
  
  // 2. Remove all ASCII divider lines completely
  clean = clean.replace(/━{40}\n?/g, '')
  
  // 3. Convert section headers into styled HTML <h2> tags
  const h2Style = 'color: #00D09C; margin-top: 30px; margin-bottom: 15px; font-size: 18px; text-transform: uppercase; letter-spacing: 0.5px;'
  clean = clean.replace(/TOP THEMES THIS WEEK/g, `<h2 style="${h2Style}">Top Themes This Week</h2>`)
  clean = clean.replace(/WHAT USERS ARE SAYING \(verbatim, anonymised\)/g, `<h2 style="${h2Style}">What Users Are Saying</h2>`)
  clean = clean.replace(/ACTION IDEAS/g, `<h2 style="${h2Style}">Action Ideas</h2>`)
  
  // 4. Convert Top Themes into readable UI cards
  clean = clean.replace(/^(\d+\.) (.*?) — (\d+ reviews) \| Avg: (.*?) \| (.*?)$/gm, 
    '<div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 15px; margin-bottom: 10px; border-radius: 8px;">' +
      '<strong style="color: #0f172a; font-size: 16px;">$1 $2</strong><br/>' +
      '<span style="color: #475569; font-size: 13px;">📊 $3 &nbsp;&nbsp;|&nbsp;&nbsp; ⭐ Avg: $4 &nbsp;&nbsp;|&nbsp;&nbsp; ⚠️ $5</span>' +
    '</div>'
  )

  // 5. Convert Action Ideas into styled list items
  clean = clean.replace(/^(\d+\.) ([^—<]+)$/gm, 
    '<div style="margin-bottom: 12px; padding-left: 5px; font-size: 15px; color: #333;">' +
      '<strong style="color: #00D09C; font-size: 16px; margin-right: 5px;">$1</strong> $2' +
    '</div>'
  )

  // 6. Convert the [Category] "Quote" lines into beautiful HTML blockquotes
  clean = clean.replace(/^\[(.*?)\] "(.*?)"$/gm, 
    '<div style="background: #ffffff; border-left: 4px solid #00D09C; padding: 12px 15px; margin-bottom: 15px; border-radius: 0 6px 6px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">' +
      '<strong style="display: block; color: #00D09C; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">$1</strong>' +
      '<span style="color: #444; font-size: 15px; font-style: italic;">"$2"</span>' +
    '</div>'
  )
  
  // 7. Replace remaining newlines with <br/>, but avoid adding <br/> right after our block tags
  clean = clean.replace(/\n/g, '<br/>')
  // Clean up double breaks around the headers and divs
  clean = clean.replace(/<\/h2><br\/><br\/>/g, '</h2>')
  clean = clean.replace(/<\/h2><br\/>/g, '</h2>')
  clean = clean.replace(/<\/div><br\/><br\/>/g, '</div>')
  clean = clean.replace(/<\/div><br\/>/g, '</div>')
  
  return clean
}

/**
 * Uses Google Drive API to create a Google Doc with the pulse content.
 *
 * @param {string} pulseText
 * @param {string} weekLabel  e.g. "12 May 2025"
 * @returns {string} docUrl
 */
export async function createGoogleDoc(pulseText, weekLabel) {
  const auth = getAuthClient()
  const drive = google.drive({ version: 'v3', auth })
  
  console.log(`[Phase 4A] Creating Google Doc for week ${weekLabel}...`)
  
  const fileMetadata = {
    name: `Groww Weekly Review Pulse — ${weekLabel}`,
    mimeType: 'application/vnd.google-apps.document'
  }
  
  const formattedHtml = formatPulseTextForUI(pulseText)

  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <table width="100%" cellpadding="20" cellspacing="0" border="0" style="background-color: #00D09C; border-radius: 8px;">
          <tr>
            <td align="center">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px;">Groww Weekly Pulse</h1>
              <p style="color: #e6fffa; margin: 5px 0 0 0; font-size: 18px;">${weekLabel}</p>
            </td>
          </tr>
        </table>
        <div style="margin-top: 30px; padding: 0 20px;">
          ${formattedHtml}
        </div>
      </body>
    </html>
  `
  
  const media = {
    mimeType: 'text/html',
    body: htmlContent
  }
  
  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    })
    const docUrl = `https://docs.google.com/document/d/${file.data.id}/edit`
    console.log(`[Phase 4A] Document created: ${docUrl}`)
    return docUrl
  } catch (error) {
    console.error('[Phase 4A] Error creating Google Doc:', error.message)
    throw error
  }
}

/**
 * Uses Google Gmail API to send the email directly.
 *
 * @param {string} pulseText
 * @param {string} weekLabel
 * @param {string} docUrl
 */
export async function sendEmail(pulseText, weekLabel, docUrl) {
  const auth = getAuthClient()
  const gmail = google.gmail({ version: 'v1', auth })
  
  if (!process.env.RECIPIENT_EMAIL) {
    throw new Error('[Phase 4B] RECIPIENT_EMAIL is not set — add it to your .env file.')
  }
  
  console.log(`[Phase 4B] Sending email to ${process.env.RECIPIENT_EMAIL}...`)
  
  const to = process.env.RECIPIENT_EMAIL
  const subject = `Groww Weekly Review Pulse — ${weekLabel}`
  
  const formattedHtml = formatPulseTextForUI(pulseText)
  
  const body = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; padding: 30px; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #00D09C;">
        <h2 style="color: #00D09C; margin: 0; font-size: 24px;">Groww Weekly Pulse 📈</h2>
        <p style="color: #666; margin-top: 5px; font-size: 14px;">${weekLabel}</p>
      </div>
      
      <p style="font-size: 16px; margin-top: 25px;">Hi there,</p>
      <p style="font-size: 16px;">Here is your weekly summary of what users are saying about Groww:</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #00D09C; margin: 25px 0;">
        <div style="font-family: inherit; margin: 0; font-size: 15px; line-height: 1.6;">${formattedHtml}</div>
      </div>
      
      <div style="text-align: center; margin: 35px 0 20px 0;">
        <a href="${docUrl}" style="background-color: #00D09C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">📄 Read Full Google Doc</a>
      </div>
      
      <hr style="border: none; border-top: 1px solid #eaeaea; margin-top: 30px; margin-bottom: 20px;" />
      <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
        Sent automatically by the Groww Review Analyser Pipeline.
      </p>
    </div>
  `
  
  // Gmail API requires base64url encoded RFC 2822 format
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`
  const messageParts = [
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ]
  
  const message = messageParts.join('\n')
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    
  try {
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    })
    console.log('[Phase 4B] Email sent successfully!')
  } catch (error) {
    console.error('[Phase 4B] Error sending email:', error.message)
    throw error
  }
}
