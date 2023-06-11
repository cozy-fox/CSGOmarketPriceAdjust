const fs = require('fs');
const axios = require('axios');

fs.readFile('config.json', (err, data) => {
  const config = JSON.parse(data);
  const wax_api_key = config.waxpeer_api_key;
  const url = 'https://market.csgo.com/api/v2/remove-all-from-sale';
  const params = {
    key: wax_api_key
  };
  axios.get(url, { params })
    .then((response) => {
      const data = response.data;
      if (response.status === 200) {
        console.log(`Success (${data.count || 0})`);
      } else {
        console.log(`Error`);
      }
    })
    .catch((error) => {
      console.error(error);
    });
});