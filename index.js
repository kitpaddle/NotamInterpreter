const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');


const options = {
  key: fs.readFileSync('private.key'),
  cert: fs.readFileSync('certificate.crt')
};

const app = express();


// set the CSP policy using the helmet middleware
/*
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'https://notaminterpreter.kitpaddle.repl.co']
    }
  })
);
*/

app.use((req, res, next) => {
  res.append('Access-Control-Allow-Origin', '*');
  res.append('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Expose-Headers', '*')
  next();
})

app.get('/notams', async (req, res) => {
  try {
    const notamData = await getNotamData();
    console.log("Success!");
    console.log("Notam data fetched from LFV for :"+notamData.length+" airports.");
    console.log("Data sent to client.");
    res.json(notamData);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

app.get('/test', (req,res)=>{
  res.send("Reply from server successful");
});

const httpsServer = https.createServer(options, app);

/*
app.listen(3000, () => {
  console.log('server started');
});
*/

httpsServer.listen(3000, () => {
  console.log('Express server running over HTTPS with self-signed certificate');
});

async function getNotamData() {
  console.log("Fetching NOTAM from LFV");
  const response = await axios.get(
    "https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=161&type=AIS"
  );

  const $ = cheerio.load(response.data);

  let text = $("pre.linkTextNormal").text().trim();
  text = text.replace(/CONTINUES ON NEXT PAGE/g, "");
  text = text.replace(/\n/g, " ");

  const entries = text.split(">>>").map((entry) => entry.trim());

  const rFindName = /^(.*?)<<</i;
  const rFindRest = /(?<=<<<).*/s;
  const rFindNIL = /[\r\n\s]*NIL[\r\n\s]*/;
  const rFindNotam = /[+-]\s{2}.*?ES\/[A-Z]\d{4}\/\d{2}/gs;

  const notamData = [];

  for (let i = 0; i < entries.length; i++) {
    if (i == 0 || i == 1) {
      continue;
    }

    const tMatch = entries[i].match(rFindRest);
    const rest = tMatch[0];

    const nameMatch = entries[i].match(rFindName);
    const aerodromeName = nameMatch[1].trim();

    const notamsArr = rest.match(rFindNotam);
    let notams = [];

    if (rFindNIL.test(rest)) {
      notams = "NIL";
    }else{
      for (let j = 0; j < notamsArr.length; j++) {
        const fromDateArr = notamsArr[j].match(
          /FROM:\s+(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2})/
        );
        const toDateArr = notamsArr[j].match(
          /TO:\s+(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2})|TO:\sPERM/
        );
        const toDateStr = toDateArr[1] || "PERM";
        const notamNameArr = notamsArr[j].match(/ES\/[A-Z]\d{4}\/\d{2}/);
        let notamContent = notamsArr[j].substring(3).trim();
        notamContent = notamContent.substring(0, notamContent.indexOf("FROM:")).trim();
  
        notams.push({
          id: notamNameArr[0],
          from: fromDateArr[1],
          to: toDateStr,
          content: notamContent,
        });
      }
    }
    /*
    // For testing purposes
    if(aerodromeName.substring(0,4)=='ESSA'){
      console.log(notamsArr);
    }*/
      
    notamData.push({
      icao: aerodromeName.substring(0, 4),
      name: aerodromeName.substring(5),
      notams: notams,
    });
  }
  /*
  // For testing purposes
  notamData.forEach(o => {
    if(o.icao == 'ESSA') console.log(o);
  })*/
  return notamData;
}

//let i = getNotamData();