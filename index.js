const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

let notamData = [];

app.get('/notams', (req, res) => {
  
  //console.log(notamData);
  res.json(notamData);
  //res.json("moo");
  console.log("Data requested. Data sent");
});

app.listen(3000, () => {
  console.log('server started');
});


function getNotamData(){
  console.log("Fetching NOTAM from LFV");
  axios.get('https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=161&type=AIS')
  .then(response => {
    const $ = cheerio.load(response.data);    
    
    let text = $('pre.linkTextNormal').text().trim();
    // Split text into two parts, first is aerodromes. Second EN-ROUTE
    // Split at the second occurence of the word EN-ROUTE
    text = text.replace(/CONTINUES ON NEXT PAGE/g, ""); // removes all instance of that string
    text = text.replace(/\n/g, ""); // removes all newlines
    
    let word = "EN-ROUTE";
    let firstIndex = text.indexOf(word);
    let secondIndex = text.indexOf(word, firstIndex + 1);

    let aerodromes = text.slice(0, secondIndex);
    let enroute = text.slice(secondIndex);

    // Separating each aerodrome into its own entry
    const entries = aerodromes.split('>>>').map(entry => entry.trim());

    const rFindName = /^(.*?)<<</i;  // get first match after <<<
    const rFindRest = /(?<=<<<).*/s;     // get what is after >>>
    const rFindNIL = /[\r\n\s]*NIL[\r\n\s]*/; // get a NIL with or without space or /n
    const rFindNotam = /[+-]\s{2}.*?ES\/[A-Z]\d{4}\/\d{2}/gs; // matching a string that starts with +/- followed by 2 white spaces, and that ends with ES/A000/00. Thats one NOTAM.
    

    for (let i=0; i<entries.length;i++){
      if (i==0 || i == 1){
        continue; // Skipping the first two as they are not aerodromes
      }
      let tMatch = entries[i].match(rFindRest); // Matching the content
      let rest = tMatch[0]; // variable rest contains the notams
      
      if (rFindNIL.test(rest)){
        continue; // If content is NIL, akip and do not save to array
      }
      // else match the name
      let nameMatch = entries[i].match(rFindName);
      let aerodromeName = nameMatch[1].trim();

      // Check content for NOTAMS and set them in array
      let notamsArr = rest.match(rFindNotam);
      let notams = [];
      for (let j=0; j<notamsArr.length; j++){
        let fromDateArr = notamsArr[j].match(/FROM:\s+(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2})/);
        let toDateArr = notamsArr[j].match(/TO:\s+(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2})|PERM/);
        let toDateStr = toDateArr[1];
        if(toDateArr[0]=="PERM"){ toDateStr="PERM"};
        let notamNameArr = notamsArr[j].match(/ES\/[A-Z]\d{4}\/\d{2}/);
        let notamContent = notamsArr[j].substring(3); // removing first 3 characters
        notamContent = notamContent.substring(0, notamContent.indexOf("FROM:")).trim();

        notams.push({id: notamNameArr[0], from: fromDateArr[1], to: toDateStr, content: notamContent});
      }
      
      // save to array JSON objects of all notams and airports
      notamData.push({icao: aerodromeName.substring(0,4), name: aerodromeName.substring(5), notams: notams});      
    }

    //console.log(notamData.length);
    //console.log(notamData);
    
  })
  .catch(error => {
    console.log(error);
  });
  
}

getNotamData();