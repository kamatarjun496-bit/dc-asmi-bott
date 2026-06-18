import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { getAsmiReply } from './ai.js';

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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ]
});

const processingUsers = new Set();

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Asmi is online as ${c.user.tag}`);
  console.log(`📢 Listening in channels: ${[...ALLOWED_CHANNELS].join(', ')}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!ALLOWED_CHANNELS.has(message.channelId)) return;

  const content = message.content?.trim();
  if (!content) return;

  if (processingUsers.has(message.author.id)) return;
  processingUsers.add(message.author.id);

  let typingInterval;
  try {
    await message.channel.sendTyping();
    typingInterval = setInterval(() => message.channel.sendTyping(), 8000);

    // Resolve mentioned users so Asmi knows who was pinged
    const mentionedUsers = message.mentions.users.map(u => `@${u.username}`).join(', ');
    const mentionedRoles = message.mentions.roles.map(r => `@${r.name}`).join(', ');

    // Build context about mentions for Asmi
    let messageContext = content;
    if (mentionedUsers) {
      messageContext += `\n[Note: This message mentions these users: ${mentionedUsers}]`;
    }
    if (mentionedRoles) {
      messageContext += `\n[Note: This message mentions these roles: ${mentionedRoles}]`;
    }

    const reply = await getAsmiReply(
      message.author.id,
      message.author.username,
      messageContext
    );

    clearInterval(typingInterval);

    // Convert any @username mentions in Asmi's reply to proper Discord pings
    const resolvedReply = await resolveUserMentions(reply, message.guild);

    if (resolvedReply.length <= 2000) {
      await message.reply({ 
        content: resolvedReply, 
        allowedMentions: { parse: ['users', 'roles'] }
      });
    } else {
      const chunks = splitMessage(resolvedReply, 2000);
      await message.reply({ 
        content: chunks[0], 
        allowedMentions: { parse: ['users', 'roles'] }
      });
      for (const chunk of chunks.slice(1)) {
        await message.channel.send({ 
          content: chunk,
          allowedMentions: { parse: ['users', 'roles'] }
        });
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    console.error(`Error handling message from ${message.author.username}:`, err);
    await message.reply({ 
      content: "hmm something went wrong on my end... give me a second and try again? 😅",
      allowedMentions: { parse: [] }
    });
  } finally {
    processingUsers.delete(message.author.id);
  }
});

// Convert @username text to proper Discord <@userId> mentions
async function resolveUserMentions(text, guild) {
  if (!guild) return text;

  const mentionPattern = /@([a-zA-Z0-9_.]+)/g;
  const matches = [...text.matchAll(mentionPattern)];

  let resolved = text;
  for (const match of matches) {
    const username = match[1].toLowerCase();
    try {
      const members = await guild.members.fetch({ query: username, limit: 1 });
      const member = members.first();
      if (member) {
        resolved = resolved.replace(match[0], `<@${member.id}>`);
      }
    } catch {}
  }

  return resolved;
}

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
