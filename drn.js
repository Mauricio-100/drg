#!/usr/bin/env node

// ==========================
//  IMPORTS DES MODULES
// ==========================
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';
import archiver from 'archiver';
import FormData from 'form-data';

// ==========================
//  CONFIGURATION
// ==========================
const SERVER_URL = 'http://localhost:10000'; 
const CONFIG_PATH = path.join(os.homedir(), '.drnconfig.json');

// ==========================
//  GESTIONNAIRE DE CONFIGURATION
// ==========================

async function loadConfig() {
  try {
    const configData = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(configData);
  } catch (error) {
    return null;
  }
}

async function saveConfig(data) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(data, null, 2));
}

async function getApiKey() {
  const config = await loadConfig();
  return config?.apiKey || null;
}

// ==========================
//  FONCTIONS UTILITAIRES
// ==========================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

function handleApiError(error) {
  if (error.response) {
    const { status, data } = error.response;
    if (status === 401 || status === 403) {
      console.error(`❌ Erreur d'authentification (${status}): ${data.error}. Votre clé API est peut-être invalide.`);
      console.error("   Essayez 'drn login <votre-clé-api>'.");
    } else {
      console.error(`❌ Erreur du serveur (${status}): ${data.error || 'Erreur inconnue'}`);
    }
  } else if (error.request) {
    console.error("❌ Erreur réseau: Impossible de contacter le serveur. Est-il démarré ?");
  } else {
    console.error("❌ Une erreur inattendue est survenue:", error.message);
  }
}

// ==========================
//  FONCTIONS DES COMMANDES
// ==========================

async function login(apiKey) {
  if (!apiKey || !apiKey.startsWith('sk-')) {
    console.error("❌ Erreur: Clé API invalide. Elle doit commencer par 'sk-'.");
    console.log("   Usage: drn login sk-xxxxxxxxxxxxxxxxxxxxxxxx");
    return;
  }
  await saveConfig({ apiKey });
  console.log("✅ Clé API sauvegardée avec succès ! Vous êtes connecté.");
}

async function whoami() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ Vous n'êtes pas connecté. Utilisez 'drn login <votre-clé-api>' d'abord.");
    return;
  }
  try {
    const response = await axios.get(`${SERVER_URL}/user/me`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    console.log("👤 Vous êtes connecté en tant que :");
    console.log(`   - Nom d'utilisateur: ${response.data.username}`);
    console.log(`   - Email: ${response.data.email}`);
  } catch (error) {
    handleApiError(error);
  }
}

async function askOrChat(message) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ Vous n'êtes pas connecté. Utilisez 'drn login <votre-clé-api>' d'abord.");
    return;
  }
  if (!message) {
    console.error("❌ Erreur: Veuillez fournir un message.");
    console.log("   Usage: drn ask \"Quelle est la capitale de la RDC ?\"");
    return;
  }
  
  console.log("🐉 Le Dragon réfléchit...");
  try {
    const response = await axios.post(`${SERVER_URL}/chat-direct`, 
      { message: message }, 
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    console.log("🤖 Réponse :");
    console.log(response.data.reply);
  } catch (error) {
    handleApiError(error);
  }
}

async function init() {
    console.log("Bienvenue dans l'initialisation de drn.json !");
    const defaults = {
        name: path.basename(process.cwd()),
        version: '1.0.0',
        description: '',
        main: 'index.js',
    };
    
    const name = await askQuestion(`Nom du paquet: (${defaults.name}) `) || defaults.name;
    const version = await askQuestion(`Version: (${defaults.version}) `) || defaults.version;
    const description = await askQuestion(`Description: `);
    const main = await askQuestion(`Point d'entrée: (${defaults.main}) `) || defaults.main;
    
    const drnConfig = { name, version, description, main };

    await fs.writeFile('drn.json', JSON.stringify(drnConfig, null, 2));
    console.log("✅ Fichier drn.json créé avec succès !");
    rl.close();
}

async function publish() {
    const apiKey = await getApiKey();
    if (!apiKey) {
        console.error("❌ Vous n'êtes pas connecté. Utilisez 'drn login <votre-clé-api>' pour publier.");
        return;
    }
    
    let drnConfig;
    try {
        drnConfig = JSON.parse(await fs.readFile('drn.json', 'utf-8'));
    } catch (error) {
        console.error("❌ Erreur: Fichier 'drn.json' introuvable. Exécutez 'drn init' d'abord.");
        return;
    }

    console.log(`📦 Publication de ${drnConfig.name}@${drnConfig.version}...`);

    // Création de l'archive zip en mémoire
    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = []; // Pour stocker les chunks du zip
    archive.pipe({
        write: (chunk) => output.push(chunk),
        end: () => {}, // Simule un stream en écriture
    });
    archive.glob('**/*', {
        cwd: process.cwd(),
        ignore: ['node_modules/**', 'drn.json', '*.zip'],
    });
    await archive.finalize();
    const zipBuffer = Buffer.concat(output);
    
    // Envoi du paquet au serveur
    const form = new FormData();
    form.append('packageName', drnConfig.name);
    form.append('version', drnConfig.version);
    form.append('description', drnConfig.description);
    form.append('package', zipBuffer, { filename: `${drnConfig.name}.zip` });

    try {
        const response = await axios.post(`${SERVER_URL}/packages/publish`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${apiKey}`,
            },
        });
        console.log(`✅ ${response.data.message}`);
    } catch (error) {
        handleApiError(error);
    }
}

function showHelp() {
  console.log(`
  Usage: drn <commande> [options]

  Commandes principales :
    init                 Initialiser un projet et créer un fichier drn.json.
    publish              Publier un paquet sur le registre.
    login <api_key>      Sauvegarder votre clé API pour vous connecter.
    whoami               Vérifier qui est connecté.
    ask "<message>"      Envoyer un message à l'IA du Dragon (alias: chat).
    chat "<message>"     Envoyer un message à l'IA du Dragon.
    
  Options:
    -h, --help           Afficher ce message d'aide.
  `);
}

// ==========================
//  POINT D'ENTRÉE DU SCRIPT
// ==========================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const primaryArg = args[1];

  switch (command) {
    case 'login':
      await login(primaryArg);
      break;
    case 'whoami':
      await whoami();
      break;
    case 'ask':
    case 'chat':
      const message = args.slice(1).join(' ');
      await askOrChat(message);
      break;
    case 'init':
        await init();
        break;
    case 'publish':
        await publish();
        break;
    case '-h':
    case '--help':
    case 'help':
      showHelp();
      break;
    case undefined:
      console.log("Bienvenue sur DRN CLI. Tapez 'drn help' pour voir les commandes.");
      break;
    default:
      console.error(`❌ Commande inconnue: '${command}'`);
      showHelp();
      break;
  }
  
  // S'assure que le processus se termine si readline a été utilisé
  if (command === 'init') {
      // rl est déjà fermé dans la fonction init
  } else {
      rl.close();
  }
}

main();
