const { google } = require('googleapis');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: 'durable-destiny-439514-r9-2ffe9a8d4e29.json',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });

async function uploadFile() {
  try {
    const fileMetadata = {
      name: 'royalchoral.3gp',
    };

    const media = {
      mimeType: 'video/3gpp', 
      body: fs.createReadStream('Royal Choral Society Hallelujah Chorus from Handels Messiah.3gp'),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });

    console.log('File uploaded successfully. File ID:', response.data.id);

    return response.data.id;
  } catch (error) {
    console.error('Error uploading the file:', error);
  }
}

uploadFile();
