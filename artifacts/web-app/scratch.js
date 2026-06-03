import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const apiKey = process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
    console.log("No API key");
    process.exit(1);
}

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
    .then(res => res.json())
    .then(data => {
        console.log(JSON.stringify(data.models.map(m => m.name), null, 2));
    });
