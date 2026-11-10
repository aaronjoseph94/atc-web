// Usage: node rasterize.cjs <size> <in.svg> <out.png>  -- renders the SVG, contained, on white
const { chromium } = require('playwright')
const fs = require('node:fs')
const [size, input, out] = process.argv.slice(2)
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: +size, height: +size } })
  const b64 = fs.readFileSync(input).toString('base64')
  await page.setContent(`<body style="margin:0;background:#fff"><img style="display:block;width:${size}px;height:${size}px;object-fit:contain" src="data:image/svg+xml;base64,${b64}"></body>`)
  await page.waitForTimeout(400)
  await page.screenshot({ path: out })
  await browser.close()
})()
