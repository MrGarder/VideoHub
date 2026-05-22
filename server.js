const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); 
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2; 
const { Innertube } = require('youtubei.js'); 
require('dotenv').config();

const app = express();

// --- НАСТРОЙКИ ---
cloudinary.config({ 
  cloud_name: 'dtcfxvsfo', 
  api_key: '231547552894299', 
  api_secret: '9slnAsQaAYy7Ub44kW6PfrzWyIM' 
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(__dirname));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }
app.use('/uploads', express.static(uploadDir));

// --- MONGODB ---
const mongoUrl = process.env.MONGO_URL || 'mongodb+srv://dmin:RedDragon505606@cluster0.rnxra9s.mongodb.net/videotube_db?appName=Cluster0';
const client = new MongoClient(mongoUrl, { connectTimeoutMS: 10000, family: 4 });
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('VideoHub_db');
        console.log("✅ MongoDB подключена успешно");
        await db.collection('users').createIndex({ username: 1 }, { unique: true });
    } catch (err) { console.error("❌ Ошибка MongoDB:", err.message); }
}
connectDB();

// --- YOUTUBE ---
let youtube; 
async function initYouTube() {
    try {
        youtube = await Innertube.create({ 
            lang: 'ru', 
            location: 'RU',
            fetcher: undefined 
        });
        console.log("🚀 Сессия YouTube Innertube успешно создана");
    } catch (err) {
        console.error("❌ Ошибка инициализации YouTube:", err.message);
    }
}
initYouTube();

// --- MULTER ---
// ... (здесь ваш код Multer) ...

// --- МАРШРУТЫ ---
// ... (здесь все ваши app.get, app.post, app.delete) ...

// --- ЗАПУСК СЕРВЕРА ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 VideoHub на MongoDB запущен! Порт: ${PORT}`);
});
