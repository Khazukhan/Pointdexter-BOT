require('dotenv/config');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');
const axios = require('axios');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const CHANNELS = [''];
const MAX_MEMORY_LENGTH = 20;
const memoryBuffer = {};

client.once('ready', () => { console.log('Pointdexter is online.'); });

client.on('messageCreate', async (message) => {
  const isDM = message.channel.type === 'DM';
  const isAllowedChannel = CHANNELS.includes(message.channel.id);
  const isMentioned = message.mentions.has(client.user);
  const isFromOwner = message.author.id === '';

  if (message.author.bot) return;
  if (!isDM && (!isAllowedChannel || !isMentioned)) return;
  if (isDM && !isFromOwner) return;

  const channelId = isDM ? `dm-${message.author.id}` : message.channel.id;
  if (!memoryBuffer[channelId]) memoryBuffer[channelId] = [];

  const content = message.content.trim();
  if (!content) return;
  await message.channel.sendTyping();

  let referencedContent = '';
  if (message.reference?.messageId) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      referencedContent = referencedMessage.content;
    } catch (err) {
      console.warn('Could not fetch referenced message:', err);
    }
  }

  const userInput = referencedContent
    ? `In reply to "${referencedContent}", ${message.author.username} said: "${content}"`
    : `${message.author.username}: ${content}`;

  memoryBuffer[channelId].push({ role: 'user', content: userInput });
  memoryBuffer[channelId] = memoryBuffer[channelId].slice(-MAX_MEMORY_LENGTH);

  let newsHeadlines = '';
  try {
    const res = await axios.get('', {
      headers: { 'X-Api-Key': process.env.NEWSAPI_KEY }
    });
    const articles = res.data.articles || [];
    if (articles.length) {
      const headlines = articles.map((a, i) => `${i + 1}. ${a.title}`);
      newsHeadlines = `These are today's news headlines:\n${headlines.join('\n')}`;
    }
  } catch (err) {
    console.warn('NewsAPI error:', err.message);
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const systemPrompts = [
    { role: 'system', content: 'Your prompts and behavioral tags will be applied here. Place them in a format that allows you to directly instruct and address yout bot.' },
 }
  ];

  const history = memoryBuffer[channelId].map(({ role, content }) => ({ role, content }));
  let assistantReply = '', continueLoop = true;
  const currentMessages = [...systemPrompts, ...history];

  while (continueLoop) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-x',
        messages: currentMessages,
        max_tokens: 350
      });
      const choice = response.choices[0];
      assistantReply += choice.message.content;
      if (choice.finish_reason === 'length') {
        currentMessages.push({ role: 'assistant', content: choice.message.content });
        currentMessages.push({ role: 'user', content: 'Please continue.' });
      } else continueLoop = false;
    } catch (error) {
      console.error('OpenAI Error:\n', error);
      return message.reply('Well, it seems my intellectual apparatus has encountered a hiccup. Please try again later. I shall make a note to not trust that method again.');
    }
  }

  memoryBuffer[channelId].push({ role: 'assistant', content: assistantReply });
  memoryBuffer[channelId] = memoryBuffer[channelId].slice(-MAX_MEMORY_LENGTH);

  if (assistantReply.length > 2000) {
    const buffer = Buffer.from(assistantReply, 'utf-8');
    const file = new AttachmentBuilder(buffer, { name: 'pointdexter_reply.txt' });
    return message.reply({ content: '📄 My reply was too long — uploading as a text file.', files: [file] });
  }

  await message.reply(assistantReply);
});

client.login(process.env.TOKEN);
