const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); // Заменили pg на mongodb
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Настройки
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(__dirname));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// --- ПОДКЛЮЧЕНИЕ К MONGODB ---
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
const client = new MongoClient(mongoUrl);
const dbName = 'VideoHub_db';
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log("✅ MongoDB подключена успешно");
        
        // Создаем индекс для уникальных имен пользователей (регистронезависимый)
        await db.collection('users').createIndex({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
    } catch (err) {
        console.error("❌ Ошибка подключения к MongoDB:", err.message);
    }
}
connectDB();

// --- MULTER CONFIG ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadFields = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

// --- АВТОРИЗАЦИЯ ---

app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({
            username,
            password: hashedPassword,
            email,
            role: username === 'MrGarder' ? 'admin' : 'user', // Делаем MrGarder админом
            created_at: new Date()
        });
        res.status(201).send('Пользователь создан');
    } catch (err) {
        if (err.code === 11000) return res.status(400).send('Этот никнейм уже занят!');
        res.status(500).send(err.message);
    }
});

app.post('/login', async (req, res) => {
    const loginData = req.body.loginData ? req.body.loginData.trim() : "";
    const { password } = req.body;
    try {
        const user = await db.collection('users').findOne({
            $or: [{ username: { $regex: new RegExp(`^${loginData}$`, 'i') } }, { email: loginData }]
        });

        if (user) {
            const isValid = await bcrypt.compare(password, user.password);
            if (isValid) res.status(200).json({ username: user.username });
            else res.status(401).send('Неверный пароль');
        } else res.status(404).send('Пользователь не найден');
    } catch (err) { res.status(500).send('Ошибка сервера'); }
});

// --- ВИДЕО ---

app.post('/upload', uploadFields, async (req, res) => {
    try {
        const { title, description, username } = req.body;
        const files = req.files;
        if (!files || !files.video) return res.status(400).send('Видео файл обязателен');

        const videoFileName = files.video[0].filename;
        const videoUrl = `/uploads/${videoFileName}`;
        const thumbUrl = (files.thumbnail && files.thumbnail[0]) ? `/uploads/${files.thumbnail[0].filename}` : null;

        await db.collection('videos').insertOne({
            title,
            description: description || '',
            url: videoUrl,
            thumbnail_url: thumbUrl,
            author_name: username,
            video_path: videoFileName,
            views: 0,
            created_at: new Date()
        });
        res.status(200).send('Опубликовано!');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/videos', async (req, res) => {
    try {
        const videos = await db.collection('videos').find().sort({ created_at: -1 }).toArray();
        res.json(videos);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/view', async (req, res) => {
    try {
        await db.collection('videos').updateOne({ _id: new ObjectId(req.params.id) }, { $inc: { views: 1 } });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

// --- АДМИНКА: УДАЛЕНИЕ ВИДЕО ---

app.delete('/admin/delete-video/:id', async (req, res) => {
    const { username } = req.query; // Передаем ник через query или headers
    const videoId = req.params.id;

    if (username !== 'MrGarder') {
        return res.status(403).json({ error: "Доступ только для MrGarder!" });
    }

    try {
        const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
        if (!video) return res.status(404).json({ error: "Видео не найдено" });

        // Удаляем файлы из папки uploads
        const filesToDelete = [video.video_path, video.thumbnail_url?.replace('/uploads/', '')];
        filesToDelete.forEach(file => {
            if (file) {
                const filePath = path.join(uploadDir, file);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });

        await db.collection('videos').deleteOne({ _id: new ObjectId(videoId) });
        res.json({ success: true, message: "Видео и файлы удалены" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Остальные роуты (лайки, комменты) нужно будет так же переписать под db.collection...
// Но база уже работает и MrGarder — главный.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 VideoHub на MongoDB запущен! Порт: ${PORT}`);
});
