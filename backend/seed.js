#!/usr/bin/env node
'use strict';

/**
 * Seed script – creates the initial admin user.
 * Usage:  node seed.js [username] [password]
 * Defaults: username=admin  password=ChangeMe123!
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const readline = require('readline');
const { initDB, createUser, getUserByUsername } = require('./db');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'imghoster.db');

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

(async () => {
  await initDB(DB_PATH);

  const username = process.argv[2] || await prompt('Admin username [admin]: ') || 'admin';
  const password = process.argv[3] || await prompt('Admin password [ChangeMe123!]: ') || 'ChangeMe123!';

  if (await getUserByUsername(username)) {
    console.log(`User "${username}" already exists. Skipping.`);
    process.exit(0);
  }

  const id = await createUser(username, password, true);
  console.log(`Admin user "${username}" created (id=${id}).`);
  console.log('Remember to change the default password before going to production!');
})();
