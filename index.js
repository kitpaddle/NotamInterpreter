const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const helmet = require('helmet');
const mongoose = require('mongoose');

// Variables to keep secret
const mongouri = 'mongodb+srv://kitpaddle:zoidberg88@cluster0.icwrw0m.mongodb.net/?retryWrites=true&w=majority'
const swedaviakey = 'af25188efa60417aa93910f37c439959';

const app = express();

/////// Swedavia variables /////////
let today;
let datetoday;
let dateminusone;
let dateminustwo;
let swedaviaData = [];

/////// Open connection to Mongo DB database
// Keeping it open as per recommendation
try{
  mongoose.connect(mongouri, {
  	useNewUrlParser: true,
  	useUnifiedTopology: true
  });
  console.log("Connected to database")
}catch{err => console.log(err)};

const dataSchema = new mongoose.Schema(
	{
    date: Date,
		datename: String,
		data: Object
	}
)

const DayData = mongoose.model('DayData', dataSchema);


// Middleware for CORS! IMPORTANT!
app.use((req, res, next) => {
  res.append('Access-Control-Allow-Origin', '*');
  res.append('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Expose-Headers', '*')
  next();
})

// GET request for NOTAM Data
app.get('/notams', async (req, res) => {
  try {
    const notamData = await getNotamData();

    console.log("Notam data fetched from LFV for :"+notamData.length+" airports.");
    console.log("Data sent to client.");
    res.json(notamData);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// GET request for NOTAM Data
app.get('/metars', async (req, res) => {
  try {
    const metarData = await getMetarData();
    console.log("Metar data fetched from LFV for :"+metarData.length+" airports.");
    console.log("Data sent to client.");
    res.json(metarData);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// GET request for SWEDAVIA data
// Checks first if data request is in local cache
// if not then database, if not then calls API
// to limit nr of API calls to Swedavia
app.get('/swedavia/:airport/:date', async (req, res) => {
  airportIATA = req.params.airport;
  searchDate = req.params.date;
  console.log("Asking server for "+airportIATA+" on the "+searchDate);

  let data = swedaviaData.find( e => e.date == searchDate);
  
  if (data != undefined) {
    console.log(data.date);
    console.log("Data already locally on server. Sending..");
    res.json(data);
    console.log("Sent back to website");
  }else{
    console.log("Data not in local cache");
    if((new Date(today).getTime())-(new Date(searchDate).getTime()) > 1000*60*60*24*2){
      console.log("Date older than D-2 days, check database.")
      DayData.exists({datename:searchDate}, function (err, doc) {
        if (err){
            console.log(err);
        }else{
          if(doc){
            console.log("Found in database")
            res.json(doc.data);
            console.log("Sent back to website");
          }else{
            console.log('Data not in database either. Nothing to return.');
          }
        }
      });
    }
    else{
      console.log("Date newer than D-2 days, check Swedavia API.")
      await getSwedaviaData(airportIATA, searchDate);
      res.json(swedaviaData.find(e => e.date == searchDate));
      console.log("Sent back to website");
    }
  }
});


// Simple call to check that server is online and well
app.get('/test', (req,res)=>{
  res.send("Reply from server successful");
});

////// START SERVER ////////
app.listen(3000, () => {
  console.log('server started');
});
///////////////////////////


////// NOTAM DATA function ////////
// This crawls official LFV AIS NOTAMs
// Parses and organises the aerodrome notams
// and return JSON object to client with data
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
  const rCutOff = "EN-ROUTE";
  const notamData = [];

  for (let i = 0; i < entries.length; i++) {
    if (i == 0 || i == 1) {
      continue;
    }

    const tMatch = entries[i].match(rFindRest);
    let rest = tMatch[0];

    // This filters out any text after the string EN-ROUTE inside a NOTAM
    let stringCheckIndex = rest.indexOf("EN-ROUTE");
    if(stringCheckIndex != -1){ rest = rest.substring(0, stringCheckIndex); }

    const nameMatch = entries[i].match(rFindName);
    const aerodromeName = nameMatch[1].trim();

    // This filters off any non-swedish airports
    if(!aerodromeName.substring(0, 4).startsWith('ES')){continue};
    
    const notamsArr = rest.match(rFindNotam);
    //console.log("NAME: "+aerodromeName);
    let notams = [];
    if (rFindNIL.test(rest)) {
      notams = "NIL";
    }else{
      //console.log("how many notams found:"+notamsArr.length);
      for (let j = 0; j < notamsArr.length; j++) {
        const fromDateArr = notamsArr[j].match(
          /FROM:\s+(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2})/
        );
        const toDateArr = notamsArr[j].match(
          /TO:\s+(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2})|TO:\sPERM/
        );
        //console.log("airport "+i+" and"+ j);
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
    notamData.push({
      icao: aerodromeName.substring(0, 4),
      name: aerodromeName.substring(5),
      notams: notams,
    });
  }
  return notamData;
}

async function getMetarData() {
  console.log("Fetching METAR from LFV");
  const response = await axios.get(
    "https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=314&type=MET"
  );

  const $ = cheerio.load(response.data);

  const metarData = [];

  $('span.tor-link-text-row-item.item-header').each((index, element) => {
    const icaoElement = $(element);
    const icao = icaoElement.text().trim();
    
    const metarElement = icaoElement.next('span.tor-link-text-row-item.item-text');
    const metar = metarElement.text().trim().replace(/=$/, ''); // Trim the "=" sign at the end

    metarData.push({icao: icao, metar: metar});
    
  });
  metarData.shift(); //removing first element as its a false one.
  return metarData;
}

getMetarData();

// Getting the data from the Swedavia API
// Saves it locally to array
// This gets called for all server request to a date
// younger than Today-2, if not already in the cache
function getSwedaviaData(airport, dateData) {
  console.log("Creating request for "+dateData);

  
  const arrRequest = axios.get('https://api.swedavia.se/flightinfo/v2/'+airport+'/arrivals/'+dateData, {
        method: 'GET',
        // Request headers
        headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Ocp-Apim-Subscription-Key': swedaviakey,}

  });
  const depRequest = axios.get('https://api.swedavia.se/flightinfo/v2/'+airport+'/departures/'+dateData, {
        method: 'GET',
        // Request headers
        headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Ocp-Apim-Subscription-Key': swedaviakey,}
  });
  console.log("Request created. Sending..");

  return new Promise((resolve, reject) => {
    axios.all([arrRequest, depRequest]).then(axios.spread((...responses) => {
    
    console.log('Request sent. Status: '+responses[0].status+' '+responses[1].status);
      
    let responseArr = responses[0].data;
    let responseDep = responses[1].data;

    if(swedaviaData.length!=0){
      let r = swedaviaData.filter( e => e.date == dateData);
      if(r.length>0){
        console.log("Already saved locally");
      }else{
        swedaviaData.push({'date': dateData, 'arrivalData': responseArr, 'departureData': responseDep});
        checkCacheLength();
      }
    }
      
    else{
      swedaviaData.push({'date': dateData, 'arrivalData': responseArr, 'departureData': responseDep});
      checkCacheLength();
    }

    console.log("Got response and saved it on server");
    console.log('Local data array containing: '+swedaviaData.length+' dates');
    resolve();
    
    })).catch(errors => {
      console.log('FAILED HTTP REQUEST TO SWEDAVIA!');
      console.log(errors);
      reject();
    });
    
  });
}

// Ensuring that local array with
// data is capped at 20 entries
function checkCacheLength(){
  if (swedaviaData.length > 20){
    swedaviaData.shift();
    console.log("Capping local cache to 20 days.");
  }
}

// Swedavia Data Update function 
// Called once a day and checks that 
// yesterday and day before yesterday are
// saved to database, if not, saves them
async function updateData(){
  
  today = new Date();
  let offset = today.getTimezoneOffset();
  today = new Date(today.getTime() - (offset*60*1000));
  datetoday = today.toISOString().split('T')[0];

  let todayMinusOne = new Date();
  todayMinusOne.setDate(today.getDate()-1);
  dateminusone = todayMinusOne.toISOString().split('T')[0];

  let todayMinusTwo = new Date();
  todayMinusTwo.setDate(today.getDate()-2);
  dateminustwo = todayMinusTwo.toISOString().split('T')[0]

  console.log('Updating dates. Today is '+datetoday);
  console.log('Fetching D-1 and D-2 to see if they can be saved to database:');  

  await getSwedaviaData('ARN', dateminusone);
  let y1 = swedaviaData.find(e => e.date == dateminusone)
  await getSwedaviaData('ARN', dateminustwo);
  let y2 = swedaviaData.find(e => e.date == dateminustwo)
    
  DayData.count({}, function( err, count){
    if (err) console.log(err)
    else console.log("Number of days in database:", count );
  });

  console.log('Check if D-1 is already saved in database..');
  DayData.exists({datename:dateminusone}, function (err, doc) {
    if (err){
        console.log(err)
    }else{
        if(doc){
          console.log('D-1 already exists. Not saving it');
        }else{
          console.log("D-1 doesn't exist. Adding it..");
          let newEntry = new DayData({date: new Date(dateminusone), datename: dateminusone, data: y1});
          newEntry.save();
          console.log('Saved D-1 to database');
        }
    }
  });
  console.log('Check if D-2 is already saved in database..');
  DayData.exists({datename:dateminustwo}, function (err, doc) {
    if (err){
        console.log(err)
    }else{
        if(doc){
          console.log('D-2 already exists. Not saving it');
        }else{
          console.log("D-2 doesn't exist. Adding it..");
          let newEntry = new DayData({date: new Date(dateminustwo), datename: dateminustwo, data: y2});
          newEntry.save();
          console.log('Saved D-2 to database');
        }
    }
  });
}

updateData();

setInterval(updateData, 1000 * 60 * 60 * 24);