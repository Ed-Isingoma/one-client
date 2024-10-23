const express = require('express')
const app = express()
const { google } = require('googleapis');
require('dotenv').config()
const nodemailer = require('nodemailer')
const { v4: uuidv4 } = require('uuid')
const sqlite3 = require('sqlite3').verbose()

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/gm, '\n'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function shareFile(fileId, email) {
  try {
    const drive = google.drive({ version: 'v3', auth });
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader', 
        type: 'user',
        emailAddress: email,
      },
    });

    console.log(`File ${fileId} shared with ${email}`);
  } catch (err) {
    console.error('Error sharing file:', err);
  }
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
					const fileId = '1T3C7-ZMPCBF5V6S0peCuvjgcklKZJAoh'
					await shareFile(fileId, email);

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
						text: `Your payment with transaction reference ${tx_ref} was successful.\nHere is a file that you can now access strictly with your registered email: https://drive.google.com/file/d/${fileId}/view`
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
	console.log('Server is running on port 3000')
})
