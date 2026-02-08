import { chromium } from "playwright";

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto("https://clawhub.ai/skills", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  
  // Get all links and their text
  const links = await page.$$eval('a[href]', (els) => 
    els.map(el => ({
      href: el.getAttribute("href"),
      text: el.textContent?.slice(0, 100)
    }))
  );
  
  console.log("Found", links.length, "links");
  console.log(JSON.stringify(links.slice(0, 25), null, 2));
  
  await browser.close();
}

debug();
