import { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

export async function ensureScreenshotDir(outputDir: string): Promise<string> {
  const screenshotDir = path.join(outputDir, "screenshots");
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  return screenshotDir;
}

export async function takeScreenshot(
  page: Page,
  outputDir: string,
  filename: string
): Promise<string> {
  const screenshotDir = await ensureScreenshotDir(outputDir);
  const filePath = path.join(screenshotDir, filename);
  await page.screenshot({
    path: filePath,
    fullPage: false,
    timeout: 5000,
  });
  return path.join("screenshots", filename);
}
