require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const policyModel = require('./policyModel');

const PORT = process.env.PORT;
const app = express();
app.use(express.json());

app.get('/', async (req, res) => {
    const reqUrl = req.query.url;
    const quality = req.query.quality;
    const db = await policyModel.find({});
    const access_token = db[0].access_token;
    const refresh_token = db[0].refresh_token;

    const verifyToken = async (token) => {
        try {
            const response = await axios.post('https://api.penpencil.co/v3/oauth/verify-token', {}, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    "randomId": "ae9e92ac-b162-4089-9830-1236bddf9761"
                }
            });
            return response.data.data.isVerified;
        } catch (error) {
            return false;
        }
    };

    const refreshToken = async () => {
        try {
            const response = await axios.post('https://api.penpencil.co/v3/oauth/refresh-token', { "refresh_token": refresh_token, "client_id": "system-admin" }, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    "randomId": "ae9e92ac-b162-4089-9830-1236bddf9761"
                }
            });

            await policyModel.findByIdAndUpdate(db[0]._id, {
                "access_token": response.data.data.access_token,
                "refresh_token": response.data.data.refresh_token
            });

            console.log("Token Updated");
            return response.data.data.access_token;
        } catch (error) {
            res.status(400).send(error.response.data);
            console.log(error.message);
            return null;
        }
    };

    let token = access_token;
    let isTokenVerified = await verifyToken(token);

    if (!isTokenVerified) {
        token = await refreshToken();
        if (!token) {
            return;
        }
        isTokenVerified = await verifyToken(token);
    }

    if (isTokenVerified) {
        if (!reqUrl || !quality) {
            return res.status(400).send({ msg: "No URL Parameter Found" });
        }

        try {
            const mainUrl = reqUrl.replace('master.mpd', `hls/${quality}`);
            const policyEncrypted = await axios.post('https://api.penpencil.co/v3/files/send-analytics-data', { 'url': `${mainUrl}/main.m3u8` }, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 24_6 like Mac OS X) AppleWebKit/605.5.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
                    'Content-Type': 'application/json',
                    'client-type': 'WEB',
                    'Authorization': `Bearer ${token}`,
                }
            });

            const getDecryptCookie = (cookie) => {
                const key = Buffer.from('pw3c199c2911cb437a907b1k0907c17n', 'utf8');
                const iv = Buffer.from('5184781c32kkc4e8', 'utf8');
                const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

                let decryptedCookie = decipher.update(cookie, 'base64', 'utf8');
                decryptedCookie += decipher.final('utf8');
                return decryptedCookie;
            };

            const parts = policyEncrypted.data.data.split('&');
            let decryptedResponse = '';
            parts.forEach((part) => {
                const [name, value] = part.split('=');
                const decryptedValue = getDecryptCookie(value);
                decryptedResponse += `${name}=${decryptedValue}&`;
            });
            decryptedResponse = decryptedResponse.slice(0, -1);

            const policy_Url = mainUrl + "/main.m3u8" + decryptedResponse;

            try {
                const main_data = await axios.get(policy_Url);
                const pattern = /(\d{3,4}\.ts)/g;
                const replacement = `${mainUrl}/$1${decryptedResponse}`;
                const newText = main_data.data.replace(pattern, replacement).replace("enc.key", `enc.key&authorization=${token}`)

                 res.set('Content-Type', 'text/plain');

                // res.set({ 'Content-Type': 'application/x-mpegURL', 'Content-Disposition': 'attachment; filename="main.m3u8"' });
                res.status(200).send(newText);
            } catch (error) {
                res.send({ msg: "Your video URL is incorrect or Please choose another resolution" });
            }
        } catch (error) {
            res.send("Error on privacy link: " + error.message);
        }
    }
});

app.get('/:videoId/hls/:quality/main.m3u8', async (req, res) => {
    const { videoId, quality } = req.params;
    const db = await policyModel.find({});
    const main_url = db[0].main_url;
    const url = `${main_url}https://d1d34p8vz63oiq.cloudfront.net/${videoId}/master.mpd&quality=${quality}`;
    // const url = `https://pw.pwjarvis.tech?v=https://d1d34p8vz63oiq.cloudfront.net/${videoId}/master.mpd&quality=${quality}`;

    try {
        const response = await axios.get(url);
        res.set('Content-Type', 'text/plain');
        // res.set('Content-Type', 'application/vnd.apple.mpegurl');
        // res.set('Content-Disposition', `attachment; filename="main.m3u8"`);
        res.send(response.data);
    } catch (error) {
        res.status(401).send(error.message);
    }
});

mongoose.connect(process.env.MONGODB_URL).then(() => {
    try {
        app.listen(PORT, () => {
            console.log(`Server Connected on Port: ${PORT}`);
        });
    } catch (error) {
        console.log(`Can't connect to the server: ${error.message}`);
    }
}).catch((error) => {
    console.log("Mongoose Connection Error: " + error.message);
});

module.exports = app;
