#!/usr/bin/env node
/**
 * Passwort-Hash für den Onepage-Schutz erzeugen — ohne Backend, ohne Datenbank.
 *
 *   npm run password:hash -- "meinPasswort"
 *   npm run password:hash            (interaktiv, Eingabe bleibt unsichtbar)
 *
 * Ausgabe: der SHA-256-Hash für VITE_APP_PASSWORD_HASH plus die fertigen
 * Kommandos für Vercel und für die lokale .env.local.
 * Anleitung: docs/ANLEITUNG.md
 */

import crypto from "node:crypto";
import readline from "node:readline";

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const askHidden = (question) =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const plain = readline.createInterface({ input: stdin, output: process.stdout });
      plain.question(question, (answer) => {
        plain.close();
        resolve(answer);
      });
      return;
    }
    const rl = readline.createInterface({ input: stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    let value = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl+C
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
      // overwrite whatever echo the terminal produced
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question + "•".repeat(value.length));
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });

const line = (text = "") => process.stdout.write(text + "\n");

const password = process.argv.slice(2).join(" ").trim() || (await askHidden("Passwort: ")).trim();

if (!password) {
  line("\n✖ Kein Passwort übergeben. Beispiel:  npm run password:hash -- \"meinPasswort\"");
  process.exit(1);
}

const hash = sha256(password);

line("");
line("┌─ SHORTSFACTORY · PASSWORT-SCHUTZ ────────────────────────────────");
line(`│ Passwort-Länge : ${password.length} Zeichen`);
line(`│ SHA-256        : ${hash}`);
line("└──────────────────────────────────────────────────────────────────");
line("");
line("1) VERCEL (Dashboard)");
line("   Projekt → Settings → Environment Variables → Add");
line("     Name : VITE_APP_PASSWORD_HASH");
line(`     Value: ${hash}`);
line("     Environments: Production + Preview (+ Development, falls gewünscht)");
line("   Danach zwingend REDEPLOYEN — Env-Variablen werden beim Build eingebrannt.");
line("");
line("2) VERCEL (CLI, alternativ)");
line(`   npx vercel env add VITE_APP_PASSWORD_HASH production <<< "${hash}"`);
line(`   npx vercel env add VITE_APP_PASSWORD_HASH preview    <<< "${hash}"`);
line("");
line("3) LOKAL (optional, .env.local — steht in .gitignore)");
line(`   echo 'VITE_APP_PASSWORD_HASH=${hash}' >> .env.local`);
line("");
line("Hinweis: Der Schutz läuft komplett im Browser (Onepage-Gate). Er hält");
line("neugierige Besucher fern, ist aber kein Ersatz für echte Server-Auth —");
line("die Zernio-Route prüft dasselbe Passwort zusätzlich serverseitig.");
line("");
