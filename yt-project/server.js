const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Добавил чтение .env файлов

const app = express();

// Настройки парсинга данных
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// --- РАЗДАЧА ФАЙЛОВ (ФРОНТЕНД И ЗАГРУЗКИ) ---

app.use(express.static(__dirname));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ (ОБНОВЛЕНО ДЛЯ RENDER) ---

const pool = new Pool({
    // Если есть DATABASE_URL (на Render), используем его, иначе — твои локальные настройки
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:0503231520@localhost:5432/VideoHub_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.query('SELECT NOW()', (err) => {
    if (err) console.error("❌ Ошибка подключения к БД:", err.message);
    else console.log("✅ База данных подключена успешно");
});

// --- НАСТРОЙКА MULTER (БЕЗ ИЗМЕНЕНИЙ) ---

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } 
});

const uploadFields = upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
]);

// --- МАРШРУТЫ: АВТОРИЗАЦИЯ (БЕЗ ИЗМЕНЕНИЙ) ---

app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, email) VALUES ($1, $2, $3)',
            [username, hashedPassword, email]
        );
        res.status(201).send('Пользователь создан');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/login', async (req, res) => {
    const loginData = req.body.loginData ? req.body.loginData.trim() : "";
    const { password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username ILIKE $1 OR email ILIKE $1', [loginData]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const isValid = await bcrypt.compare(password, user.password);
            if (isValid) res.status(200).json({ username: user.username });
            else res.status(401).send('Неверный пароль');
        } else res.status(404).send('Пользователь не найден');
    } catch (err) { res.status(500).send('Ошибка сервера'); }
});

// --- МАРШРУТЫ: ВИДЕО (ИСПРАВЛЕНЫ ССЫЛКИ) ---

app.post('/upload', uploadFields, async (req, res) => {
    try {
        const { title, description, username } = req.body;
        const files = req.files;
        if (!files || !files.video) return res.status(400).send('Видео файл обязателен');

        const videoFileName = files.video[0].filename;
        
        // Убрал localhost:3000, чтобы ссылки работали везде
        const videoUrl = `/uploads/${videoFileName}`;
        const thumbUrl = (files.thumbnail && files.thumbnail[0]) 
            ? `/uploads/${files.thumbnail[0].filename}` 
            : null;

        const userRes = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (userRes.rows.length === 0) return res.status(404).send('Автор не найден');
        
        await pool.query(
            `INSERT INTO videos (title, description, url, thumbnail_url, author_id, video_path) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [title, description || '', videoUrl, thumbUrl, userRes.rows[0].id, videoFileName]
        );
        res.status(200).send('Опубликовано!');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/videos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                v.*, 
                u.username as author_name,
                (SELECT COUNT(*) FROM video_likes WHERE video_id = v.id) as likes
            FROM videos v 
            JOIN users u ON v.author_id = u.id 
            ORDER BY v.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/view', async (req, res) => {
    try {
        await pool.query('UPDATE videos SET views = views + 1 WHERE id = $1', [req.params.id]);
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

// --- МАРШРУТЫ: ЛАЙКИ И ДИЗЛАЙКИ (БЕЗ ИЗМЕНЕНИЙ) ---

app.get('/videos/:id/likes-status', async (req, res) => {
    const videoId = req.params.id;
    const { username } = req.query;
    try {
        const countRes = await pool.query('SELECT COUNT(*) FROM video_likes WHERE video_id = $1', [videoId]);
        let isLiked = false;
        let isDisliked = false;

        if (username) {
            const checkLike = await pool.query('SELECT * FROM video_likes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
            isLiked = checkLike.rows.length > 0;

            const checkDislike = await pool.query('SELECT * FROM video_dislikes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
            isDisliked = checkDislike.rows.length > 0;
        }
        res.json({ count: parseInt(countRes.rows[0].count), isLiked, isDisliked });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/like', async (req, res) => {
    const { username } = req.body;
    const videoId = req.params.id;
    if(!username) return res.status(401).send("Нужна авторизация");
    try {
        await pool.query('DELETE FROM video_dislikes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
        const check = await pool.query('SELECT * FROM video_likes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM video_likes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
            res.json({ action: 'unliked' });
        } else {
            await pool.query('INSERT INTO video_likes (user_name, video_id) VALUES ($1, $2)', [username, videoId]);
            res.json({ action: 'liked' });
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/dislike', async (req, res) => {
    const { username } = req.body;
    const videoId = req.params.id;
    if(!username) return res.status(401).send("Нужна авторизация");
    try {
        await pool.query('DELETE FROM video_likes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
        const check = await pool.query('SELECT * FROM video_dislikes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM video_dislikes WHERE user_name = $1 AND video_id = $2', [username, videoId]);
            res.json({ action: 'undisliked' });
        } else {
            await pool.query('INSERT INTO video_dislikes (user_name, video_id) VALUES ($1, $2)', [username, videoId]);
            res.json({ action: 'disliked' });
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- МАРШРУТЫ: ПОДПИСКИ (БЕЗ ИЗМЕНЕНИЙ) ---

app.get('/subscribe/status', async (req, res) => {
    const { follower, authorName } = req.query;
    try {
        const authorRes = await pool.query('SELECT id FROM users WHERE username = $1', [authorName]);
        if (authorRes.rows.length === 0) return res.json({ subscribed: false });
        const check = await pool.query('SELECT * FROM subscriptions WHERE follower_name = $1 AND author_id = $2', [follower, authorRes.rows[0].id]);
        res.json({ subscribed: check.rows.length > 0 });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/subscribe', async (req, res) => {
    const { follower, authorName } = req.body;
    try {
        const authorRes = await pool.query('SELECT id FROM users WHERE username = $1', [authorName]);
        if (authorRes.rows.length === 0) return res.status(404).send('Автор не найден');
        const authorId = authorRes.rows[0].id;
        const check = await pool.query('SELECT * FROM subscriptions WHERE follower_name = $1 AND author_id = $2', [follower, authorId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM subscriptions WHERE follower_name = $1 AND author_id = $2', [follower, authorId]);
            res.json({ status: 'unsubscribed' });
        } else {
            await pool.query('INSERT INTO subscriptions (follower_name, author_id) VALUES ($1, $2)', [follower, authorId]);
            res.json({ status: 'subscribed' });
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/subscribe/count/:authorName', async (req, res) => {
    try {
        const authorRes = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.authorName]);
        if (authorRes.rows.length === 0) return res.json({ count: 0 });
        const countRes = await pool.query('SELECT COUNT(*) FROM subscriptions WHERE author_id = $1', [authorRes.rows[0].id]);
        res.json({ count: parseInt(countRes.rows[0].count) });
    } catch (err) { res.status(500).send(err.message); }
});

// --- МАРШРУТЫ: ИСТОРИЯ (БЕЗ ИЗМЕНЕНИЙ) ---

app.post('/history/add', async (req, res) => {
    const { username, videoId } = req.body;
    if (!username || !videoId) return res.status(400).send('Данные не полные');
    try {
        await pool.query('DELETE FROM watch_history WHERE user_name = $1 AND video_id = $2', [username, videoId]);
        await pool.query('INSERT INTO watch_history (user_name, video_id) VALUES ($1, $2)', [username, videoId]);
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/history/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const result = await pool.query(`
            SELECT h.id as history_id, v.*, u.username as author_name
            FROM watch_history h 
            JOIN videos v ON h.video_id = v.id 
            JOIN users u ON v.author_id = u.id
            WHERE h.user_name = $1 
            ORDER BY h.watched_at DESC`, [username]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/history/item/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM watch_history WHERE id = $1', [req.params.id]);
        res.status(200).send('Запись удалена');
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/history/:username', async (req, res) => {
    try {
        await pool.query('DELETE FROM watch_history WHERE user_name = $1', [req.params.username]);
        res.send('История очищена');
    } catch (err) { res.status(500).send(err.message); }
});

// --- МАРШРУТЫ: КОММЕНТАРИИ (БЕЗ ИЗМЕНЕНИЙ) ---

app.get('/videos/:id/comments', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM video_comments WHERE video_id = $1 ORDER BY created_at DESC', [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/videos/:id/comments', async (req, res) => {
    const { username, text } = req.body;
    const videoId = req.params.id;
    if (!username || !text) return res.status(400).send("Не все поля заполнены");
    try {
        await pool.query('INSERT INTO video_comments (video_id, user_name, comment_text) VALUES ($1, $2, $3)', [videoId, username, text]);
        res.status(201).send("Комментарий добавлен");
    } catch (err) { res.status(500).send(err.message); }
});

// --- МАРШРУТЫ: УДАЛЕНИЕ ВИДЕО (БЕЗ ИЗМЕНЕНИЙ) ---

app.delete('/delete-video/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT video_path FROM videos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send("Видео не найдено");
        
        const fileName = result.rows[0].video_path;
        await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
        
        if (fileName) {
            const filePath = path.join(__dirname, 'uploads', fileName);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        res.status(200).send("Удалено");
    } catch (err) { res.status(500).send(err.message); }
});

// ЗАПУСК СЕРВЕРА (ОБНОВЛЕНО ДЛЯ RENDER)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 VideoHub запущен на порту ${PORT}!`);
});