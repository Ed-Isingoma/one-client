const express = require('express')
const app = express()
require('dotenv').config()
const { v4: uuidv4 } = require('uuid')

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
    
    const package = {
        tx_ref: uuidv4(),
        amount: 500,
        currency: 'UGX',
        email: 'eddiisingoma@gmail.com',
        phone_number: '+256' + req.body.phone,
        redirect_url: 'https://kisembopayments.vercel.app/redirect'
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
        res.send({error: er})
    }
})

server.listen(3000, () => {
    console.log('Socket Server is running on port 3000')
})
