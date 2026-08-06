import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const targets = [
  path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.blteam.styleforge.json"),
  path.join(os.homedir(), "Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts/com.blteam.styleforge.json"),
  path.join(os.homedir(), "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/com.blteam.styleforge.json"),
  path.join(os.homedir(), "Library/Application Support/Chromium/NativeMessagingHosts/com.blteam.styleforge.json"),
  path.join(os.homedir(), "Library/Application Support/VisualForge/visualforge-native-host")
];

for (const target of targets) {
  await unlink(target).then(
    () => process.stdout.write(`已移除：${target}\n`),
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    }
  );
}
