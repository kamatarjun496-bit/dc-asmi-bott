import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { getAsmiReply } from './ai.js';

// Validate required env vars
const required = ['DISCORD_TOKEN', 'GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ALLOWED_CHANNEL_IDS'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const ALLOWED_CHANNELS = new Set(
  process.env.ALLOWED_CHANNEL_IDS.split(',').map(id => id.trim()).filter(Boolean)
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// Track which users Asmi is currently replying to (prevents duplicate replies)
const processingUsers = new Set();

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Asmi is online as ${c.user.tag}`);
  console.log(`📢 Listening in channels: ${[...ALLOWED_CHANNELS].join(', ')}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore bots and self
  if (message.author.bot) return;

  // Only respond in allowed channels
  if (!ALLOWED_CHANNELS.has(message.channelId)) return;

  // Ignore empty messages
  const content = message.content?.trim();
  if (!content) return;

  // Prevent duplicate processing for same user
  if (processingUsers.has(message.author.id)) return;
  processingUsers.add(message.author.id);

  // Show typing indicator while processing
  let typingInterval;
  try {
    await message.channel.sendTyping();
    typingInterval = setInterval(() => message.channel.sendTyping(), 8000);

    const reply = await getAsmiReply(
      message.author.id,
      message.author.username,
      content
    );

    clearInterval(typingInterval);

    // Discord has a 2000 char limit per message — split if needed
    if (reply.length <= 2000) {
      await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
    } else {
      const chunks = splitMessage(reply, 2000);
      await message.reply({ content: chunks[0], allowedMentions: { repliedUser: false } });
      for (const chunk of chunks.slice(1)) {
        await message.channel.send(chunk);
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    console.error(`Error handling message from ${message.author.username}:`, err);
    await message.reply({ 
      content: "hmm something went wrong on my end... give me a second and try again? 😅",
      allowedMentions: { repliedUser: false }
    });
  } finally {
    processingUsers.delete(message.author.id);
  }
});

function splitMessage(text, maxLength) {
  const chunks = [];
  while (text.length > maxLength) {
    let split = text.lastIndexOf('\n', maxLength);
    if (split === -1) split = maxLength;
    chunks.push(text.slice(0, split));
    text = text.slice(split).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}

client.login(process.env.DISCORD_TOKEN);
