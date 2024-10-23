const express = require('express')
const app = express()
require('dotenv').config()
const nodemailer = require('nodemailer')
const { v4: uuidv4 } = require('uuid')
const sqlite3 = require('sqlite3').verbose()
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
// const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const TOKEN_PATH = path.join(__dirname, 'token.json');

const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id, client_secret, redirect_uris[0]
);

if (fs.existsSync(TOKEN_PATH)) {
  const token = fs.readFileSync(TOKEN_PATH);
  oAuth2Client.setCredentials(JSON.parse(token));
} else {
  getNewToken(oAuth2Client);
}

const db = new sqlite3.Database('./payments.db', (err) => {
	if (err) {
		console.error('Error opening database:', err.message)
	} else {
		// console.log('Connected to the SQLite database.')

		db.run(`CREATE TABLE IF NOT EXISTS payments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT,
			tx_ref TEXT,
			phone_number TEXT
		)`)
	}
})

app.use(express.json())

app.use((req, res, next) => {
	res.set('Content-Security-Policy', "default-src 'self' https://one-client.onrender.com; script-src 'self' 'unsafe-inline';")
	res.set('Cross-Origin-Opener-Policy', "cross-origin")
	res.set('Access-Control-Allow-Origin', "*")
	res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
	res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
	next()
})

app.options('*', (req, res) => {
	res.set('Access-Control-Allow-Origin', "*")
	res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
	res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
	res.sendStatus(200)
})

app.get('/', (req, res) => {
	res.send('Hello client')
})

app.post('/pay', async (req, res) => {
	console.log('email and phone received:', req.body.email, req.body.phone)

	const tx_ref = uuidv4()
	const email = req.body.email
	const phone_number = '+256' + req.body.phone
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const phoneRegex = /^\d{9}$/;
	if (!emailRegex.test(email) || !phoneRegex.test(req.body.phone)) {
		res.send({ error: "Please avoid tampering with the code" })
		return
	}

	db.run('INSERT INTO payments (email, tx_ref, phone_number) VALUES (?, ?, ?)',
		[email, tx_ref, phone_number], (err) => {
			if (err) {
				console.error('Error inserting into database:', err.message)
				return res.status(500).send({ error: 'Database error' })
			}
			console.log('Inserted record with tx_ref:', tx_ref)
		})

	const package = {
		tx_ref,
		amount: 500,
		currency: 'UGX',
		email: email,
		phone_number: phone_number,
		redirect_url: 'https://kisembopaymentstransit.vercel.app/'
	}
	try {
		const otp = await fetch("https://api.flutterwave.com/v3/charges?type=mobile_money_uganda", {
			method: "POST",
			headers: {
				'Authorization': 'Bearer ' + process.env.FLW_SECRET_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(package)
		})
		const resp = await otp.json()
		console.log('response from contacting flwave:', resp)
		if (resp.status == 'success') {
			res.send({ redirect: resp.meta.authorization.redirect })
		}
	} catch (er) {
		res.send({ error: er })
	}
})

function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this URL:', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);

      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
      console.log('Token stored to', TOKEN_PATH);
    });
  });
}

async function grantEmailPermission(email) {
	const fileId = '432442342'
	try {
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader', 
        type: 'user',
        emailAddress: email,
      },
    });

    // Optionally send an email notification about the shared file
    // await drive.files.update({
    //   fileId: fileId,
    //   requestBody: {
    //     emailMessage: 'You have been granted access to this file.',
    //   },
    // });

    res.status(200).json({ message: `File shared with ${email}` });
  } catch (error) {
    console.error('Error sharing file:', error);
    res.status(500).json({ error: 'Error sharing the file' });
  }
}

app.post('/afterbill', async (req, res) => {
	try {
		if (req.headers["verif-hash"] != process.env.FLW_SECRET_HASH) throw new Error('Hash values do not match')

		const data = req.body.data
		if (!data) {
			throw new Error('"Data" is missing in the request body')
		}

		if (data.status === 'successful') {
			const tx_ref = data.tx_ref

			db.get('SELECT email FROM payments WHERE tx_ref = ?', [tx_ref], async (err, row) => {
				if (err) {
					console.error('Error retrieving data from database:', err.message)
					return res.status(500).send({ error: 'Database error' })
				}

				if (row) {
					const email = row.email
					console.log('Email retrieved:', email)
					await grantEmailPermission(email)

					let transporter = nodemailer.createTransport({
						service: 'gmail',
						auth: {
							user: process.env.GMAIL_USER,
							pass: process.env.GMAIL_PASS
						}
					})

					let mailOptions = {
						from: process.env.GMAIL_USER,
						to: email,
						subject: 'Payment Successful',
						text: `Your payment with transaction reference ${tx_ref} was successful.`
					}

					transporter.sendMail(mailOptions, (error, info) => {
						if (error) {
							console.error('Error sending email:', error)
							// return res.status(500).send({ error: 'Email sending error' })
						} else {
							console.log('Email sent: ' + info.response)
							res.send({ message: 'Payment confirmed and email sent' })
						}
					})
				} else {
					res.status(404).send({ error: 'No record found for tx_ref' })
				}
			})
		}
	} catch (er) {
		res.send({ error: er.message })
	}
})

app.listen(3000, () => {
	// console.log('Server is running on port 3000')
})
