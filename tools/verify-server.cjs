#!/usr/bin/env node
/**
 * 企业微信回调URL验证服务器（独立运行，不依赖Gateway）
 *
 * 用法：
 *   TOKEN=xxx ENCODING_AES_KEY=xxx node verify-server.js
 *
 * 然后在另一个终端：
 *   cloudflared tunnel --url http://localhost:9999
 *
 * 把 cloudflare 给的 https URL 填到企业微信后台的回调URL
 */
const http = require("node:http");
const crypto = require("node:crypto");

const PORT = parseInt(process.env.PORT ?? "9999", 10);
const TOKEN = process.env.TOKEN ?? "";
const ENCODING_AES_KEY = process.env.ENCODING_AES_KEY ?? "";

if (!TOKEN || !ENCODING_AES_KEY) {
  console.error("❌ 必须设置 TOKEN 和 ENCODING_AES_KEY 环境变量");
  console.error("");
  console.error("用法:");
  console.error('  TOKEN="你的token" ENCODING_AES_KEY="你的key" node verify-server.js');
  console.error("");
  console.error("TOKEN: 在企业微信后台回调配置中自定义的，32位以内英文/数字");
  console.error("ENCODING_AES_KEY: 在企业微信后台点「随机获取」得到的43位字符串");
  process.exit(1);
}

// ── Crypto functions (same as src/crypto.ts) ──

function deriveAesKey(encodingAESKey) {
  return Buffer.from(encodingAESKey + "=", "base64");
}

function computeSignature(token, timestamp, nonce, encrypt) {
  const items = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash("sha1").update(items.join("")).digest("hex");
}

function decryptMsg(encodingAESKey, encrypted) {
  const key = deriveAesKey(encodingAESKey);
  const iv = key.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  const content = decrypted.subarray(0, decrypted.length - pad);
  const msgLen = content.readUInt32BE(16);
  const message = content.subarray(20, 20 + msgLen).toString("utf8");
  const receiverId = content.subarray(20 + msgLen).toString("utf8");
  return { message, receiverId };
}

function xmlTag(xml, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}>(.+?)</${tag}>`);
  const m = xml.match(re);
  return m?.[1] ?? m?.[2];
}

// ── HTTP Server ──

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`\n${new Date().toISOString()} ${req.method} ${url.pathname}${url.search}`);

  if (req.method === "GET") {
    const msgSignature = url.searchParams.get("msg_signature");
    const timestamp = url.searchParams.get("timestamp");
    const nonce = url.searchParams.get("nonce");
    const echostr = url.searchParams.get("echostr");

    if (!msgSignature || !timestamp || !nonce || !echostr) {
      console.log("  → Health check (missing params), returning 200");
      res.writeHead(200);
      res.end("OK");
      return;
    }

    console.log("  → URL验证请求");

    const expected = computeSignature(TOKEN, timestamp, nonce, echostr);
    const valid = expected === msgSignature;
    console.log(`  签名验证: ${valid ? "✅ 通过" : "❌ 失败"}`);
    console.log(`  期望: ${expected}`);
    console.log(`  实际: ${msgSignature}`);

    if (!valid) {
      res.writeHead(403);
      res.end("signature mismatch");
      return;
    }

    try {
      const { message, receiverId } = decryptMsg(ENCODING_AES_KEY, echostr);
      console.log(`  解密成功: msg="${message}", receiverId="${receiverId}"`);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(message);
      console.log("  ✅ 验证完成！企业微信应该显示保存成功");
    } catch (err) {
      console.error("  ❌ 解密失败:", err.message);
      res.writeHead(500);
      res.end("decrypt error");
    }
    return;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      console.log("  → POST回调事件");

      const encryptedMsg = xmlTag(body, "Encrypt");
      if (encryptedMsg) {
        try {
          const { message } = decryptMsg(ENCODING_AES_KEY, encryptedMsg);
          const token = xmlTag(message, "Token");
          const openKfId = xmlTag(message, "OpenKfId");
          console.log(`  解密成功: Token=${token}, OpenKfId=${openKfId}`);
        } catch (err) {
          console.error("  解密失败:", err.message);
        }
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
    });
    return;
  }

  res.writeHead(200);
  res.end("OK");
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       企业微信回调URL验证服务器 (独立运行)           ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  监听端口: ${String(PORT).padEnd(42)}║
║  TOKEN: ${TOKEN.slice(0, 20).padEnd(44)}║
║  EncodingAESKey: ${ENCODING_AES_KEY.slice(0, 20)}...${" ".repeat(22)}║
║                                                      ║
║  下一步:                                             ║
║  1. 新终端运行:                                      ║
║     cloudflared tunnel --url http://localhost:${PORT}   ║
║  2. 复制 cloudflare 给的 https URL                   ║
║  3. 企业微信后台 → 应用 → 接收消息设置:             ║
║     - URL: <粘贴cloudflare URL>/wechat-kf            ║
║     - Token: ${TOKEN.slice(0, 38).padEnd(38)}║
║     - EncodingAESKey: <与环境变量一致>               ║
║  4. 点保存，看到本窗口出现"✅ 验证完成"即成功       ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
});
