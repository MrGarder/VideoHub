const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); 
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { OAuth2Client } = require('google-auth-library'); 
require('dotenv').config();

const app = express();
const googleClient = new OAuth2Client("897716797553-spvtnmo96h8mnn9tioa4t4ir1iqv60qh.apps.googleusercontent.com");

// --- НАСТРОЙКА CLOUDINARY ---
cloudinary.config({ 
  cloud_name: 'dk7o3keez', 
  api_key: '669527537632519', 
  api_secret: 'TVzkbUKrfSFNT8TV6oKThhonSCg' 
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());
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

// --- Вспомогательная функция (внутренняя) ---
async function createNotification(toUser, fromUser, text, videoId) {
    if (!toUser || !fromUser || toUser === fromUser) return;
    try {
        await db.collection('notifications').insertOne({
            to_user: toUser,
            from_user: fromUser,
            text: text,
            video_id: videoId,
            read: false,
            created_at: new Date()
        });
    } catch (e) { console.error("Ошибка создания уведомления:", e); }
}

// --- НАСТРОЙКА MULTER ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadFields = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
const imgUpload = multer({ storage: storage });

// --- МАРШРУТЫ: АВТОРИЗАЦИЯ ---

app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    const cleanUsername = username ? username.trim() : "";
    if (!cleanUsername || cleanUsername.length < 3) return res.status(400).send('Никнейм слишком короткий');
    try {
        const existingUser = await db.collection('users').findOne({ 
            username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') } 
        });
        if (existingUser) return res.status(400).send('Этот никнейм уже занят');
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({
            username: cleanUsername, password: hashedPassword, email,
            avatar_url: '', banner_url: '', created_at: new Date()
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
            if (isValid) res.status(200).json({ username: user.username, avatarUrl: user.avatar_url, bannerUrl: user.banner_url });
            else res.status(401).send('Неверный пароль');
        } else res.status(404).send('Пользователь не найден');
    } catch (err) { res.status(500).send('Ошибка сервера'); }
});

app.post('/google-auth', async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: "897716797553-spvtnmo96h8mnn9tioa4t4ir1iqv60qh.apps.googleusercontent.com",
        });
        const payload = ticket.getPayload();
        const email = payload['email'];
        const name = payload['given_name'];
        const picture = payload['picture'];
        const googleId = payload['sub'];
        let user = await db.collection('users').findOne({ email: email });
        if (!user) {
            const newUser = { username: name, email: email, avatar_url: picture, googleId: googleId, created_at: new Date() };
            await db.collection('users').insertOne(newUser);
            user = newUser;
        }
        res.status(200).json({ username: user.username, avatarUrl: user.avatar_url });
    } catch (error) { res.status(401).send("Ошибка Google Auth"); }
});

// --- ОБНОВЛЕНИЕ ПРОФИЛЯ ---

app.post('/update-profile', async (req, res) => {
    const { oldUsername, newUsername } = req.body;
    const cleanNewName = newUsername ? newUsername.trim() : "";
    if (!cleanNewName || cleanNewName.length < 3) return res.status(400).send("Никнейм слишком короткий");
    try {
        const userExists = await db.collection('users').findOne({ username: { $regex: new RegExp(`^${cleanNewName}$`, 'i') } });
        if (userExists) return res.status(400).send("Этот никнейм уже занят");
        await db.collection('users').updateOne({ username: oldUsername }, { $set: { username: cleanNewName } });
        await db.collection('videos').updateMany({ author_name: oldUsername }, { $set: { author_name: cleanNewName } });
        await db.collection('video_comments').updateMany({ user_name: oldUsername }, { $set: { user_name: cleanNewName } });
        res.json({ success: true, newUsername: cleanNewName });
    } catch (err) { res.status(500).send("Ошибка сервера: " + err.message); }
});

app.post('/update-avatar', imgUpload.single('avatar'), async (req, res) => {
    const { username } = req.body;
    if (!req.file) return res.status(400).send('Файл не выбран');
    try {
        const user = await db.collection('users').findOne({ username });
        if (user && user.avatar_id) await cloudinary.uploader.destroy(user.avatar_id);
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "videohub/profiles", quality: "auto", transformation: [{ width: 200, height: 200, crop: "fill" }]
        });
        await db.collection('users').updateOne({ username }, { $set: { avatar_url: result.secure_url, avatar_id: result.public_id } });
        fs.unlinkSync(req.file.path);
        res.json({ success: true, avatarUrl: result.secure_url });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/update-banner', imgUpload.single('banner'), async (req, res) => {
    const { username } = req.body;
    if (!req.file) return res.status(400).send('Файл не выбран');
    try {
        const user = await db.collection('users').findOne({ username });
        if (user && user.banner_id) await cloudinary.uploader.destroy(user.banner_id);
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "videohub/banners", quality: "auto", transformation: [{ width: 1200, height: 400, crop: "fill" }]
        });
        await db.collection('users').updateOne({ username }, { $set: { banner_url: result.secure_url, banner_id: result.public_id } });
        fs.unlinkSync(req.file.path);
        res.json({ success: true, bannerUrl: result.secure_url });
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/user-profile/:username', async (req, res) => {
    try {
        const user = await db.collection('users').findOne({ username: req.params.username });
        if (!user) return res.status(404).send('Не найден');
        res.json({ username: user.username, avatarUrl: user.avatar_url, bannerUrl: user.banner_url });
    } catch (err) { res.status(500).send(err.message); }
});

// --- ВИДЕО ---

app.post('/upload', uploadFields, async (req, res) => {
    let videoLocalPath = "";
    try {
        const { title, description, username } = req.body;
        const files = req.files;
        if (!files || !files.video) return res.status(400).send('Видео файл обязателен');
        
        videoLocalPath = files.video[0].path;

        const videoResult = await cloudinary.uploader.upload(videoLocalPath, {
            resource_type: "video", 
            folder: "videohub/videos",
            use_filename: true,
            unique_filename: true
        });

        if (!videoResult || !videoResult.secure_url) {
            throw new Error("Cloudinary не вернул данные");
        }

        let finalThumbUrl = "";
        if (files.thumbnail && files.thumbnail[0]) {
            const thumbResult = await cloudinary.uploader.upload(files.thumbnail[0].path, { folder: "videohub/thumbs" });
            finalThumbUrl = thumbResult.secure_url;
            if (fs.existsSync(files.thumbnail[0].path)) fs.unlinkSync(files.thumbnail[0].path);
        } else {
            finalThumbUrl = videoResult.secure_url.substring(0, videoResult.secure_url.lastIndexOf(".")) + ".jpg";
        }

        const insertResult = await db.collection('videos').insertOne({
            title, description: description || '', url: videoResult.secure_url,
            thumbnail_url: finalThumbUrl, author_name: username, cloudinary_id: videoResult.public_id,
            views: 0, created_at: new Date()
        });

        try {
            const subscribers = await db.collection('subscriptions').find({ author_name: username }).toArray();
            if (subscribers.length > 0) {
                const notifications = subscribers.map(sub => ({
                    to_user: sub.follower_name,
                    from_user: username,
                    text: `опубликовал(а) новое видео: "${title}"`,
                    video_id: insertResult.insertedId.toString(),
                    read: false,
                    created_at: new Date()
                }));
                await db.collection('notifications').insertMany(notifications);
            }
        } catch (e) {}

        if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
        res.status(200).send('Опубликовано!');

    } catch (err) { 
        if (videoLocalPath && fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
        console.error("Ошибка:", err);
        res.status(500).send("Ошибка: " + err.message); 
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
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send("Некорректный ID");
        await db.collection('videos').updateOne({ _id: new ObjectId(req.params.id) }, { $inc: { views: 1 } });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/user-videos/:username', async (req, res) => {
    try {
        const videos = await db.collection('videos').find({ author_name: req.params.username }).sort({ created_at: -1 }).toArray();
        res.json(videos);
    } catch (err) { res.status(500).send(err.message); }
});

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
            const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
            if (video) await createNotification(video.author_name, username, "оценил(а) ваше видео", videoId);
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
            await createNotification(authorName, follower, "подписался(ась) на вас", null);
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

app.get('/videos/:id/comments', async (req, res) => {
    try {
        const result = await db.collection('video_comments').find({ video_id: req.params.id }).sort({ created_at: -1 }).toArray();
        res.json(result);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/comments', async (req, res) => {
    const { username, text } = req.body;
    const videoId = req.params.id;
    try {
        await db.collection('video_comments').insertOne({
            video_id: videoId, user_name: username, comment_text: text, created_at: new Date()
        });
        
        if (!text.startsWith('@')) {
            const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
            if (video) await createNotification(video.author_name, username, `оставил(а) комментарий под видео`, videoId);
        }

        res.status(201).send("Комментарий добавлен");
    } catch (err) { res.status(500).send(err.message); }
});

// НОВЫЙ МАРШРУТ: Удаление комментария
app.delete('/videos/:id/comments/:commentId', async (req, res) => {
    try {
        const { id, commentId } = req.params;
        const { username } = req.body;

        if (!ObjectId.isValid(commentId)) return res.status(400).send("Некорректный ID комментария");

        // Ищем комментарий
        const comment = await db.collection('video_comments').findOne({ _id: new ObjectId(commentId) });
        if (!comment) return res.status(404).send("Комментарий не найден");

        // Ищем видео, чтобы узнать автора канала
        const video = await db.collection('videos').findOne({ _id: new ObjectId(id) });

        // Проверка прав: автор коммента, автор видео или админ
        const isAuthorOfComment = (comment.user_name === username);
        const isAuthorOfVideo = (video && video.author_name === username);
        const isAdmin = (username === "admin" || username === "MrGarder");

        if (isAuthorOfComment || isAuthorOfVideo || isAdmin) {
            await db.collection('video_comments').deleteOne({ _id: new ObjectId(commentId) });
            res.status(200).json({ success: true });
        } else {
            res.status(403).send("Нет прав на удаление");
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- МАРШРУТЫ: УВЕДОМЛЕНИЯ ---

app.get('/notifications/:username', async (req, res) => {
    try {
        const notes = await db.collection('notifications').find({ to_user: req.params.username }).sort({ created_at: -1 }).limit(20).toArray();
        res.json(notes);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/notifications/read', async (req, res) => {
    try {
        const { username } = req.body;
        await db.collection('notifications').updateMany({ to_user: username, read: false }, { $set: { read: true } });
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/notifications/add', async (req, res) => {
    const { to_user, from_user, text, video_id } = req.body;
    try {
        await createNotification(to_user, from_user, text, video_id);
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// --- АДМИН-ПАНЕЛЬ ---

app.get('/admin/users', async (req, res) => {
    try {
        const users = await db.collection('users').find({}, { projection: { password: 0 } }).toArray();
        res.json(users);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/admin/delete-user/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send("Некорректный ID");
        await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/admin/delete-video/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username } = req.query;
        if (!ObjectId.isValid(id)) return res.status(400).send("Некорректный ID");
        const video = await db.collection('videos').findOne({ _id: new ObjectId(id) });
        if (!video) return res.status(404).json({ success: false });
        if (username !== "MrGarder" && username !== video.author_name) return res.status(403).json({ success: false });
        if (video.cloudinary_id) await cloudinary.uploader.destroy(video.cloudinary_id, { resource_type: 'video' });
        await db.collection('videos').deleteOne({ _id: new ObjectId(id) });
        res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 VideoHub на MongoDB запущен! Порт: ${PORT}`);
});
