const { createWriteStream } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const { Composer, Markup, session } = require('micro-bot')
const rateLimit = require('telegraf-ratelimit')
const ffmpeg = require('fluent-ffmpeg')
const mkdirp = require('mkdirp')
const { service } = require('invoke-service')
const fetch = require('node-fetch')

const limitConfig = {
  window: 5000,
  limit: 1,
  onLimitExceeded: ({ answerCbQuery }) => answerCbQuery('Easy, easy', true)
}
const fetchCoubInfo = service('http://coub.com/api/v2/coubs/:coubId')

const bot = new Composer()
bot.use(session())
bot.start(({ reply }) => reply('Send me any COUB link'))
bot.help(({ reply }) => reply('Bot source code: https://github.com/dotcypress/coub2tg'))
bot.hears(/https:\/\/coub.com\/view\/(.+)/ig, async ({ reply, match }) => {
  const info = await fetchCoubInfo({ coubId: match[1] })
  await reply(`https://coub.com/view/${info.permalink}`, Markup.inlineKeyboard([
    Markup.callbackButton('Convert to Video', `coub:video:${info.permalink}`),
    Markup.callbackButton('Convert to Video Note', `coub:note:${info.permalink}`)
  ]).extra())
})
bot.action(/coub:(.+):(.+)/ig, rateLimit(limitConfig),
  async ({ replyWithVideo, replyWithVideoNote, answerCbQuery, match }) => {
    await answerCbQuery('Converting...')
    const isVideoNote = match[1] === 'note'
    const answer = await convert(match[2], isVideoNote)
    if (isVideoNote) {
      replyWithVideoNote(answer)
    } else {
      replyWithVideo(answer)
    }
  }
)

async function convert (coubId, crop) {
  const { duration, dimensions, file_versions: files } = await fetchCoubInfo({ coubId })
  const folder = join(tmpdir(), 'coubs', Math.random().toString())
  mkdirp.sync(folder)
  const videoFile = join(folder, 'video.mp4')
  const audioFile = join(folder, 'audio.mp3')
  const resultFile = join(folder, 'out.mp4')

  await Promise.all([
    downloadFile(files.html5.audio.high.url, audioFile),
    downloadFile(files.html5.video.med.url, videoFile, true)
  ])

  const clipLength = duration > 10 ? duration : Math.ceil(10 / duration) * duration
  const minSize = Math.min(...dimensions.med)
  return new Promise((resolve, reject) => {
    const task = ffmpeg()
      .addOutputOption('-t', clipLength)
      .input(videoFile)
      .addInputOption('-stream_loop', '-1')
      .input(audioFile)
      .on('error', reject)
      .on('end', () => resolve({ source: resultFile }))
    if (crop) {
      task.addOutputOption('-vf', `crop=${minSize}:${minSize}`)
    }
    task.save(resultFile)
  })
}

async function downloadFile (url, fileName, patch) {
  const res = await fetch(url)
  await new Promise((resolve, reject) => {
    if (patch) {
      res.body.once('data', (chunk) => { chunk[0] = chunk[1] = 0 })
    }
    const fileStream = createWriteStream(fileName)
    fileStream.on('finish', resolve)
    res.body.on('error', reject)
    res.body.pipe(fileStream)
  })
}

module.exports = bot
