const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// --- CONFIGURATION ---
// 1. Get your Firebase Service Account Key from Firebase Console 
// (Project Settings > Service Accounts > Generate New Private Key)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const appId = process.env.FLIPLINK_APP_ID; // From your dashboard URL or 'sms-relay-app'

app.post('/sms', async (req, res) => {
  const from = req.body.From.replace('+', '');
  const body = req.body.Body;
  const twilioNumber = req.body.To;

  try {
    // Find all groups in your dashboard
    const groupsSnap = await db.collection('artifacts').doc(appId)
      .collection('public').doc('data').collection('groups').get();
    
    // Find the group this sender belongs to
    const targetGroupDoc = groupsSnap.docs.find(d => d.data().members.includes(from));

    if (targetGroupDoc) {
      const groupData = targetGroupDoc.data();
      const recipients = groupData.members.filter(m => m !== from);
      
      // Broadcast to everyone else
      await Promise.all(recipients.map(num => 
        client.messages.create({
          body: `(${groupData.name}) ${from}: ${body}`,
          from: twilioNumber, 
          to: '+' + num
        })
      ));

      // Log the activity back to the dashboard
      await db.collection('artifacts').doc(appId)
        .collection('public').doc('data').collection('logs').add({
          from: from,
          body: body,
          groupName: groupData.name,
          recipientCount: recipients.length,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }
  } catch (err) {
    console.error('Relay Error:', err);
  }

  // Always respond with empty TwiML so Twilio doesn't error
  res.type('text/xml').send('<Response></Response>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay active on port ${PORT}`));
