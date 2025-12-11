import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use('/examples', express.static('examples'));
app.use('/dist', express.static('dist'));

app.post('/tagtics/feedback', (req, res) => {
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== 'TEST_PROJECT_KEY') {
        console.warn('Invalid API Key:', apiKey);
        // For testing purposes, we might want to allow it or just warn
        // return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('Received Feedback Payload:');
    console.log(JSON.stringify(req.body, null, 2));

    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`Feedback receiver listening at http://localhost:${PORT}`);
});
