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
  const h2Style = 'color: #00D09C; margin-top: 30px; margin-bottom: 15px; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px;'
  clean = clean.replace(/TOP THEMES THIS WEEK/g, `<h2 style="${h2Style}">Top Themes This Week</h2>`)
  clean = clean.replace(/WHAT USERS ARE SAYING \(verbatim, anonymised\)/g, `<h2 style="${h2Style}">What Users Are Saying</h2>`)
  clean = clean.replace(/ACTION IDEAS/g, `<h2 style="${h2Style}">Action Ideas</h2>`)
  
  // 4. Convert Top Themes into a premium HTML Table
  clean = clean.replace(/(<h2[^>]*>Top Themes This Week<\/h2>)([\s\S]*?)(<h2[^>]*>What Users Are Saying<\/h2>)/, (match, h2Top, content, h2What) => {
    const rows = content.replace(/^(\d+\.) (.*?) — (\d+ reviews) \| Avg: (.*?) \| (.*?)$/gm, 
      '<tr>' +
        '<td style="padding: 14px; border-bottom: 1px solid #e2e8f0;"><strong style="color: #0A2540; font-size: 15px;">$1 $2</strong></td>' +
        '<td style="padding: 14px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 14px; text-align: center;">📊 $3</td>' +
        '<td style="padding: 14px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 14px; text-align: center;">⭐ $4</td>' +
        '<td style="padding: 14px; border-bottom: 1px solid #e2e8f0; color: #ef4444; font-size: 14px; text-align: right; font-weight: bold;">⚠️ $5</td>' +
      '</tr>'
    )
    
    const tableHTML = `
      <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; border-collapse: separate; border-spacing: 0; margin-bottom: 25px; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden;">
        <thead>
          <tr style="background-color: #f8fafc;">
            <th style="padding: 14px; border-bottom: 2px solid #e2e8f0; text-align: left; color: #0A2540; font-size: 13px; text-transform: uppercase;">Theme</th>
            <th style="padding: 14px; border-bottom: 2px solid #e2e8f0; text-align: center; color: #0A2540; font-size: 13px; text-transform: uppercase;">Volume</th>
            <th style="padding: 14px; border-bottom: 2px solid #e2e8f0; text-align: center; color: #0A2540; font-size: 13px; text-transform: uppercase;">Rating</th>
            <th style="padding: 14px; border-bottom: 2px solid #e2e8f0; text-align: right; color: #0A2540; font-size: 13px; text-transform: uppercase;">Critical</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `
    // Strip the remaining raw text newlines from content so they don't become <br/> tags later
    return h2Top + tableHTML.replace(/\n/g, '') + h2What
  })

  // 5. Convert Action Ideas into styled cards (safe for email clients)
  // Fix: Exclude newlines (\r\n) from the match so it only captures a single line.
  clean = clean.replace(/^(\d+)\. ([^\n\r—<]+)$/gm, 
    '<div style="background: #ffffff; border: 1px solid #eaeaea; padding: 16px; margin-bottom: 12px; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border-left: 4px solid #2563EB;">' +
      '<div style="color: #2563EB; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">💡 Action Idea $1</div>' +
      '<div style="color: #334155; font-size: 17px; line-height: 1.4;">$2</div>' +
    '</div>'
  )

  // 6. Convert the [Category] "Quote" lines into beautiful HTML blockquotes
  clean = clean.replace(/^\[(.*?)\] "(.*?)"$/gm, 
    '<div style="background: #ffffff; border-left: 4px solid #2563EB; padding: 16px; margin-bottom: 15px; border-radius: 0 6px 6px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">' +
      '<strong style="display: block; color: #2563EB; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">$1</strong>' +
      '<span style="color: #444; font-size: 17px; font-style: italic; line-height: 1.4;">"$2"</span>' +
    '</div>'
  )
  
  // 7. Strip out excessive newlines before converting to <br/> to fix the "empty" layout look
  clean = clean.replace(/\n{3,}/g, '\n\n')
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
        <table width="100%" cellpadding="20" cellspacing="0" border="0" style="background-color: #0A2540; border-radius: 8px;">
          <tr>
            <td align="center">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px;">Groww Weekly Pulse</h1>
              <p style="color: #94A3B8; margin: 5px 0 0 0; font-size: 18px;">${weekLabel}</p>
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
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #0A2540;">
        <h2 style="color: #0A2540; margin: 0; font-size: 24px;">Groww Weekly Pulse 📈</h2>
        <p style="color: #666; margin-top: 5px; font-size: 14px;">${weekLabel}</p>
      </div>
      
      <p style="font-size: 16px; margin-top: 25px;">Hi there,</p>
      <p style="font-size: 16px;">Here is your weekly summary of what users are saying about Groww:</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #0A2540; margin: 25px 0;">
        <div style="font-family: inherit; margin: 0; font-size: 15px; line-height: 1.6;">${formattedHtml}</div>
      </div>
      
      <div style="text-align: center; margin: 35px 0 20px 0;">
        <a href="${docUrl}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">📄 Read Full Google Doc</a>
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
