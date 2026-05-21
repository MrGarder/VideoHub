const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); 
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2; // Подключили Cloudinary
const { Innertube } = require('youtubei.js'); // Импорт для работы с YouTube
require('dotenv').config();

const app = express();

// --- НАСТРОЙКА CLOUDINARY ---
cloudinary.config({ 
  cloud_name: 'dtcfxvsfo', 
  api_key: '231547552894299', 
  api_secret: '9slnAsQaAYy7Ub44kW6PfrzWyIM' 
});

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
const mongoUrl = process.env.MONGO_URL || 'mongodb+srv://dmin:RedDragon505606@cluster0.rnxra9s.mongodb.net/videotube_db?appName=Cluster0';
const client = new MongoClient(mongoUrl, {
    connectTimeoutMS: 10000, 
    family: 4 
});
const dbName = 'VideoHub_db';
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log("✅ MongoDB подключена успешно");
        await db.collection('users').createIndex({ username: 1 }, { unique: true });
    } catch (err) {
        console.error("❌ Ошибка подключения к MongoDB:", err.message);
    }
}
connectDB();

// --- ГЛОБАЛЬНАЯ ИНИЦИАЛИЗАЦИЯ YOUTUBE ---
let youtube;
async function initYouTube() {
    try {
        youtube = await Innertube.create({ lang: 'ru', location: 'RU' });
        console.log("🚀 Сессия YouTube Innertube успешно создана");
    } catch (err) {
        console.error("❌ Ошибка инициализации YouTube сессии:", err.message);
    }
}
initYouTube();

// --- НАСТРОЙКА MULTER ---
const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const uploadDisk = multer({ storage: diskStorage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadFields = uploadDisk.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

const memoryStorage = multer.memoryStorage();
const uploadAvatar = multer({ 
    storage: memoryStorage, 
    limits: { fileSize: 100 * 1024 * 1024 } 
}).any();


// --- МАРШРУТЫ: ПРОФИЛИ ---

app.get('/user/profile/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const user = await db.collection('users').findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') } 
        });
        
        if (!user) {
            return res.status(404).json({ error: "Пользователь не найден" });
        }
        
        res.json({
            username: user.username,
            name: user.name || user.username,
            avatar: user.avatar || "",
            about: user.about || ""
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/user/update-profile', uploadAvatar, async (req, res) => {
    try {
        const { username, name, about } = req.body;
        if (!username) return res.status(400).json({ error: "Имя пользователя обязательно" });

        const updateData = {};
        if (name) updateData.name = name;
        if (about !== undefined) updateData.about = about;

        if (req.files && req.files.length > 0) {
            const file = req.files[0];

            const cloudinaryUpload = () => {
                return new Promise((resolve, reject) => {
                    const stream = cloudinary.uploader.upload_stream(
                        {
                            folder: "videohub/avatars",
                            transformation: [{ width: 150, height: 150, crop: "fill" }]
                        },
                        (error, result) => {
                            if (result) resolve(result);
                            else reject(error);
                        }
                    );
                    stream.end(file.buffer);
                });
            };

            const avatarResult = await cloudinaryUpload();
            updateData.avatar = avatarResult.secure_url;
        }

        const result = await db.collection('users').updateOne(
            { username: { $regex: new RegExp(`^${username}$`, 'i') } },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Пользователь не найден" });
        }

        const updatedUser = await db.collection('users').findOne({ username });

        res.status(200).json({
            success: true,
            message: "Профиль успешно обновлен",
            avatar: updatedUser.avatar || "",
            name: updatedUser.name || updatedUser.username,
            about: updatedUser.about || ""
        });

    } catch (err) {
        console.error("Ошибка при обновлении профиля:", err);
        res.status(500).json({ error: err.message });
    }
});


// --- МАРШРУТЫ: АВТОРИЗАЦИЯ ---

app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({
            username,
            password: hashedPassword,
            email,
            name: username,
            avatar: "",      
            about: "",
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
        if (!files || !files.video) return res.status(400).send('Video файл обязателен');

        const videoLocalPath = files.video[0].path;

        const videoResult = await cloudinary.uploader.upload(videoLocalPath, {
            resource_type: "video",
            folder: "videohub/videos"
        });

        let finalThumbUrl = "";
        if (files.thumbnail && files.thumbnail[0]) {
            const thumbResult = await cloudinary.uploader.upload(files.thumbnail[0].path, {
                folder: "videohub/thumbs"
            });
            finalThumbUrl = thumbResult.secure_url;
            if (fs.existsSync(files.thumbnail[0].path)) fs.unlinkSync(files.thumbnail[0].path);
        } else {
            finalThumbUrl = videoResult.secure_url.replace(/\.[^/.]+$/, ".jpg");
        }

        await db.collection('videos').insertOne({
            title,
            description: description || '',
            url: videoResult.secure_url,
            thumbnail_url: finalThumbUrl,
            author_name: username,
            cloudinary_id: videoResult.public_id,
            views: 0,
            created_at: new Date()
        });

        if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);

        res.status(200).send('Опубликовано!');
    } catch (err) { 
        console.error(err);
        res.status(500).send("Ошибка загрузки в облако: " + err.message); 
    }
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

app.put('/videos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;
        if (!ObjectId.isValid(id)) return res.status(400).send("Некорректный ID");
        await db.collection('videos').updateOne({ _id: new ObjectId(id) }, { $set: { title: title } });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/view', async (req, res) => {
    try {
        if (ObjectId.isValid(req.params.id)) {
            await db.collection('videos').updateOne({ _id: new ObjectId(req.params.id) }, { $inc: { views: 1 } });
        }
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/user-videos/:username', async (req, res) => {
    try {
        const videos = await db.collection('videos').find({ author_name: req.params.username }).sort({ created_at: -1 }).toArray();
        res.json(videos);
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

app.get('/subscribe/count/:authorName', async (req, res) => {
    try {
        const count = await db.collection('subscriptions').countDocuments({ author_name: req.params.authorName });
        res.json({ count });
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

app.delete('/admin/delete-video/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username } = req.query;

        if (!ObjectId.isValid(id)) return res.status(400).send("Некорректный ID");
        const video = await db.collection('videos').findOne({ _id: new ObjectId(id) });
        if (!video) return res.status(404).json({ success: false, error: "Не найдено" });

        if (username !== "MrGarder" && username !== video.author_name) {
            return res.status(403).json({ success: false, error: "Нет прав!" });
        }
        
        if (video.cloudinary_id) {
            await cloudinary.uploader.destroy(video.cloudinary_id, { resource_type: 'video' });
        }

        await db.collection('videos').deleteOne({ _id: new ObjectId(id) });
        res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- УВЕДОМЛЕНИЯ ---

app.get('/notifications/:username', async (req, res) => {
    try {
        const notes = await db.collection('notifications').find({ to_user: req.params.username }).sort({ _id: -1 }).limit(20).toArray();
        res.json(notes);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/notifications/add', async (req, res) => {
    try {
        await db.collection('notifications').insertOne({ ...req.body, read: false, created_at: new Date() });
        res.sendStatus(201);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/notifications/read', async (req, res) => {
    try {
        await db.collection('notifications').updateMany({ to_user: req.body.username }, { $set: { read: true } });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

// --- ИНТЕГРАЦИЯ YOUTUBE ---

app.get('/api/youtube/trends', async (req, res) => {
    try {
        if (!youtube) {
            return res.status(503).json({ error: "Сессия YouTube еще инициализируется, обновите страницу через секунду" });
        }

        const searchResults = await youtube.search('тренды'); 
        
        if (!searchResults || !searchResults.videos) {
            return res.json([]);
        }

        const videos = searchResults.videos.map(v => ({
            _id: v.id || '',
            title: v.title?.text || v.title?.toString() || 'Без названия',
            description: v.description?.text || v.description?.toString() || '',
            url: v.id ? `https://www.youtube.com/embed/${v.id}` : '',
            thumbnail_url: v.thumbnails?.[0]?.url || '',
            author_name: v.author?.name || 'YouTube Автор',
            views: v.views?.text || v.short_view_count?.text || "0 просмотров",
            created_at: v.published?.text || "Недавно"
        }));

        res.json(videos);
    } catch (err) {
        console.error("Ошибка парсинга трендов:", err);
        res.status(500).json({ error: "Не удалось загрузить видео с YouTube" });
    }
});

app.get('/api/youtube/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).send("Введите запрос для поиска");

        if (!youtube) {
            return res.status(503).json({ error: "Сессия YouTube еще инициализируется" });
        }

        const searchResults = await youtube.search(query);
        
        if (!searchResults || !searchResults.videos) {
            return res.json([]);
        }

        const videos = searchResults.videos.map(v => ({
            _id: v.id || '',
            title: v.title?.text || v.title?.toString() || 'Без названия',
            description: v.description?.text || v.description?.toString() || '',
            url: v.id ? `https://www.youtube.com/embed/${v.id}` : '',
            thumbnail_url: v.thumbnails?.[0]?.url || '',
            author_name: v.author?.name || 'YouTube Автор',
            views: v.views?.text || v.short_view_count?.text || "0 просмотров",
            created_at: v.published?.text || "Недавно"
        }));

        res.json(videos);
    } catch (err) {
        console.error("Ошибка поиска YouTube:", err);
        res.status(500).json({ error: "Ошибка при поиске" });
    }
});

// --- ИНТЕГРАЦИЯ КОММЕНТАРИЕВ YOUTUBE ---
app.get('/api/youtube/comments/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        if (!youtube) return res.status(503).json({ error: "YouTube сессия не готова" });

        const videoInfo = await youtube.getInfo(videoId);
        
        // 1. Получаем секцию комментариев
        const commentsData = await videoInfo.getComments();
        
        // 2. В актуальных версиях комментарии обычно лежат в .sections[0].contents
        // Используем опциональную цепочку (?.), чтобы избежать падения, если структура изменилась
        const rawComments = commentsData.sections?.[0]?.contents || commentsData.contents || [];

       // 3. Маппинг данных
const comments = rawComments.map(c => {
    // Безопасное извлечение имени автора
    let author = "Аноним";
    if (c.author?.text?.text) author = c.author.text.text;
    else if (c.author?.text?.runs) author = c.author.text.runs[0].text;

    // Безопасное извлечение текста комментария (через runs)
    let text = "";
    if (c.content?.text) text = c.content.text;
    else if (c.content?.runs) text = c.content.runs.map(r => r.text).join('');

    return { user: author, text: text };
}).filter(c => c.text.trim() !== ""); // Убираем пустые записи

        res.json(comments);
    } catch (err) {
        console.error("Ошибка получения комментариев YouTube:", err);
        res.status(500).json({ error: "Не удалось загрузить комментарии: " + err.message });
    }
});

// В функции initYouTube
async function initYouTube() {
    try {
        youtube = await Innertube.create({ 
            lang: 'ru', 
            location: 'RU',
            // Иногда помогает отключение предзагрузки некоторых данных
            fetcher: undefined 
        });
        console.log("🚀 Сессия YouTube Innertube успешно создана");
    } catch (err) {
        console.error("❌ Ошибка инициализации:", err.message);
    }
}
// --- ИНИЦИАЛИЗАЦИЯ И ЗАПУСК ---
async function initYouTube() {
    try {
        youtube = await Innertube.create({ 
            lang: 'ru', 
            location: 'RU' 
        });
        console.log("🚀 Сессия YouTube Innertube успешно создана");
    } catch (err) {
        console.error("❌ Ошибка инициализации:", err.message);
    }
}

// ВАЖНО: Вызов функции инициализации
initYouTube(); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 VideoHub на MongoDB запущен! Порт: ${PORT}`);
});
