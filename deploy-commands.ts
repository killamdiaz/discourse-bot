// deploy-commands.ts
import { REST, Routes } from 'discord.js';
import { config } from './config.js';

const commands = [
  {
    name: 'close',
    description: 'Closes the support ticket.',
  },
];

const rest = new REST({ version: '10' }).setToken(config.discord.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();