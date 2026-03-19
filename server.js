const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); // Заменили pg на mongodb
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Настройки парсинга данных
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// --- РАЗДАЧА ФАЙЛОВ ---
app.use(express.static(__dirname));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ПОДКЛЮЧЕНИЕ К MONGODB ---
const mongoUrl = process.env.MONGO_URL || 'mongodb+srv://admin:wOWgCpoBtti6gneb@cluster0.rnxra9s.mongodb.net/VideoHub_db?retryWrites=true&w=majority';
const client = new MongoClient(mongoUrl, {
    connectTimeoutMS: 10000, // Ждать 10 секунд
    family: 4 // Принудительно использовать IPv4 (часто решает проблему ENOTFOUND)
});
const dbName = 'VideoHub_db';
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log("✅ MongoDB подключена успешно");
        
        // Индексы
        await db.collection('users').createIndex({ username: 1 }, { unique: true });
    } catch (err) {
        console.error("❌ Ошибка подключения к MongoDB:", err.message);
    }
}
connectDB();

// --- НАСТРОЙКА MULTER ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadFields = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

// --- МАРШРУТЫ: АВТОРИЗАЦИЯ ---

app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({
            username,
            password: hashedPassword,
            email,
            created_at: new Date()
        });
        res.status(201).send('Пользователь создан');
    } catch (err) { res.status(500).send(err.message); }
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

// --- МАРШРУТЫ: ВИДЕО ---

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
        for (let v of videos) {
            v.likes = await db.collection('video_likes').countDocuments({ video_id: v._id.toString() });
        }
        res.json(videos);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/view', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send("Некорректный ID");
        await db.collection('videos').updateOne({ _id: new ObjectId(req.params.id) }, { $inc: { views: 1 } });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

// --- ЛАЙКИ И ДИЗЛАЙКИ ---

app.get('/videos/:id/likes-status', async (req, res) => {
    const videoId = req.params.id;
    const { username } = req.query;
    try {
        const count = await db.collection('video_likes').countDocuments({ video_id: videoId });
        let isLiked = username ? !!(await db.collection('video_likes').findOne({ user_name: username, video_id: videoId })) : false;
        let isDisliked = username ? !!(await db.collection('video_dislikes').findOne({ user_name: username, video_id: videoId })) : false;
        res.json({ count, isLiked, isDisliked });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/like', async (req, res) => {
    const { username } = req.body;
    const videoId = req.params.id;
    if(!username) return res.status(401).send("Нужна авторизация");
    try {
        await db.collection('video_dislikes').deleteOne({ user_name: username, video_id: videoId });
        const check = await db.collection('video_likes').findOne({ user_name: username, video_id: videoId });
        if (check) {
            await db.collection('video_likes').deleteOne({ user_name: username, video_id: videoId });
            res.json({ action: 'unliked' });
        } else {
            await db.collection('video_likes').insertOne({ user_name: username, video_id: videoId });
            res.json({ action: 'liked' });
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/dislike', async (req, res) => {
    const { username } = req.body;
    const videoId = req.params.id;
    if(!username) return res.status(401).send("Нужна авторизация");
    try {
        await db.collection('video_likes').deleteOne({ user_name: username, video_id: videoId });
        const check = await db.collection('video_dislikes').findOne({ user_name: username, video_id: videoId });
        if (check) {
            await db.collection('video_dislikes').deleteOne({ user_name: username, video_id: videoId });
            res.json({ action: 'undisliked' });
        } else {
            await db.collection('video_dislikes').insertOne({ user_name: username, video_id: videoId });
            res.json({ action: 'disliked' });
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- ПОДПИСКИ ---

app.get('/subscribe/status', async (req, res) => {
    const { follower, authorName } = req.query;
    try {
        const check = await db.collection('subscriptions').findOne({ follower_name: follower, author_name: authorName });
        res.json({ subscribed: !!check });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/subscribe', async (req, res) => {
    const { follower, authorName } = req.body;
    try {
        const check = await db.collection('subscriptions').findOne({ follower_name: follower, author_name: authorName });
        if (check) {
            await db.collection('subscriptions').deleteOne({ follower_name: follower, author_name: authorName });
            res.json({ status: 'unsubscribed' });
        } else {
            await db.collection('subscriptions').insertOne({ follower_name: follower, author_name: authorName });
            res.json({ status: 'subscribed' });
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- ИСТОРИЯ ---

app.post('/history/add', async (req, res) => {
    const { username, videoId } = req.body;
    try {
        await db.collection('watch_history').deleteOne({ user_name: username, video_id: videoId });
        await db.collection('watch_history').insertOne({ user_name: username, video_id: videoId, watched_at: new Date() });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/history/:username', async (req, res) => {
    try {
        const history = await db.collection('watch_history').find({ user_name: req.params.username }).sort({ watched_at: -1 }).toArray();
        const videoIds = history.map(h => {
            try { return new ObjectId(h.video_id); } catch(e) { return null; }
        }).filter(id => id !== null);
        
        const videos = await db.collection('videos').find({ _id: { $in: videoIds } }).toArray();
        res.json(videos);
    } catch (err) { res.status(500).send(err.message); }
});

// --- КОММЕНТАРИИ ---

app.get('/videos/:id/comments', async (req, res) => {
    try {
        const result = await db.collection('video_comments').find({ video_id: req.params.id }).sort({ created_at: -1 }).toArray();
        res.json(result);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/comments', async (req, res) => {
    const { username, text } = req.body;
    try {
        await db.collection('video_comments').insertOne({
            video_id: req.params.id,
            user_name: username,
            comment_text: text,
            created_at: new Date()
        });
        res.status(201).send("Комментарий добавлен");
    } catch (err) { res.status(500).send(err.message); }
});

// --- УДАЛЕНИЕ ВИДЕО ---

app.delete('/delete-video/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send("Некорректный ID");
        const video = await db.collection('videos').findOne({ _id: new ObjectId(req.params.id) });
        if (!video) return res.status(404).send("Видео не найдено");
        
        const fileName = video.video_path;
        await db.collection('videos').deleteOne({ _id: new ObjectId(req.params.id) });
        
        if (fileName) {
            const filePath = path.join(__dirname, 'uploads', fileName);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        res.status(200).send("Удалено");
    } catch (err) { res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 VideoHub на MongoDB запущен! Порт: ${PORT}`);
});