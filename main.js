const axios = require("axios");
const fs = require('fs');

const PRICEMPIRE_BASE_URL = "https://pricempire.com/api";
const WAX_BASE_URL = "https://market.csgo.com/api/v2";

var priceMPIREApiKey = "";
var waxPeerApiKey = "";
var priceUpperDelimiter = 1.5;
var priceLowerDelimiter = 1.08;
var secondsBetweenWaxListingsUpdates = 60;
var hoursBetweenPriceMPIREPriceUpdate = 6.0;
var hoursBetweenWaxNewListing = 6.0;
var detailedDelimiter = [];
var showResultDetail = false
var priceMPIREItemData = {};
var myListedItems = [];
var waxCache = {};
var lastWaxListingUpdate = Date.now();
var lastPriceMPIREUpdate = Date.now();
var lastWaxNewListing = Date.now();
var itemIdNamePair = {};

function error() {
  console.log(
    "  Wax sent an uncomprerrensible response or closed the connection unexpectedly!"
  );
}

async function loadConfig() {

  var file = await fs.readFileSync('config.json', 'utf8');
  var config = await JSON.parse(file);

  timeToCancelAction = config.time_to_cancel_action;
  priceMPIREApiKey = config.pricempire_api_key;
  waxPeerApiKey = config.waxpeer_api_key;
  priceLowerDelimiter = config.default_delimiter[0];
  priceUpperDelimiter = config.default_delimiter[1];
  maxItemsPerListing = config.max_items_per_listing;
  secondsBetweenWaxRequest = config.seconds_between_wax_request;
  detailedDelimiter = config.detailed_delimiter;
  waxUpdateLimit = config.wax_update_limit;
  secondsBetweenWaxListingsUpdates = config.seconds_between_wax_listings_updates;
  hoursBetweenPriceMPIREPriceUpdate = config.hours_between_pricempire_price_update;
  hoursBetweenWaxNewListing = config.hours_between_wax_new_listing;
  showResultDetail = config.show_result_detail;
  lastWaxNewListing = Date.now() - (hoursBetweenWaxNewListing * 60 * 60 * 1000 + 1);
  lastPriceMPIREUpdate = Date.now() - (hoursBetweenPriceMPIREPriceUpdate * 60 * 60 * 1000 + 1);
  lastWaxListingUpdate = Date.now() - (secondsBetweenWaxListingsUpdates * 1000 + 1);

  console.log("Your config:", config);
}

async function loadPriceMPIREInfo() {

  if ((Date.now() - lastPriceMPIREUpdate) <= (hoursBetweenPriceMPIREPriceUpdate * 60 * 60 * 1000)) {
    if (fs.existsSync('pricempire.txt')) {
      return;
    }
  }

  console.log("===> FETCHING PRICEMPIRE PRICES");

  lastPriceMPIREUpdate = Date.now();
  var res = await axios.get(
    PRICEMPIRE_BASE_URL + "/v3/getAllItems",
    {
      params: {
        api_key: priceMPIREApiKey,
        currency: "USD",
        appId: "730",
        sources: "buff",
      },
    }
  );

  if (res.status !== 200) { error(); return; }

  priceMPIREItemData = res.data;
  await fs.writeFileSync('pricempire.txt', JSON.stringify(priceMPIREItemData, null, 2));

  console.log("  Caching pricempire prices...");
  console.log("  Success!");
  console.log("");
}


function getLowerDelimiter(name) {
  var delimiter = priceLowerDelimiter;
  var price = priceMPIREItemData[name].buff.price * 10;
  for (eachDelimiter of detailedDelimiter) {
    if (eachDelimiter.range[0] * 1000 < price && eachDelimiter.range[1] * 1000 > price) {
     // console.log(name,"low",price,eachDelimiter.range[0] * 1000,eachDelimiter.range[1] * 1000,eachDelimiter.delimiter[0])
      
      delimiter = eachDelimiter.delimiter[0];
    }
  }
  return price * delimiter;
}

function getUpperDelimiter(name) {
  var delimiter = priceUpperDelimiter;
  var price = priceMPIREItemData[name].buff.price * 10;

  for (eachDelimiter of detailedDelimiter) {
    if (eachDelimiter.range[0] * 1000 < price && eachDelimiter.range[1] * 1000 > price) {
      //console.log(name,"low",price,eachDelimiter.range[0] * 1000,eachDelimiter.range[1] * 1000,eachDelimiter.delimiter[1])
      delimiter = eachDelimiter.delimiter[1];
    }
  }
  return price * delimiter;
}

function findLeastWaxPrice(returnedItems) {
  // find the least price listed in waxpeer
  var leastPrice = Number.MAX_VALUE;
  returnedItems.forEach(item => {
    var price = item.price;
    leastPrice = Math.min(price, leastPrice);
  })
  return leastPrice;
}

async function getWaxPriceFor(item) {
  var name = item.market_hash_name;
  if (name && waxCache.hasOwnProperty(name)) {
    returnedItems = waxCache[name];
  } else {
    try {

      var res = await axios.get(
        WAX_BASE_URL + `/search-item-by-hash-name`,
        {
          params: {
            hash_name: name,
            key: waxPeerApiKey
          }
        }
      );
      var setTime = Date.now();
      while (true) { if (Date.now() - setTime > 200) break; }

    } catch { }
    if (res.status !== 200) {
      error();
      return await getLowerDelimiter(item.market_hash_name) / 1000;
    }

    returnedItems = res.data.data;
    waxCache[name] = returnedItems;
  }
  if (!returnedItems) {
    return await getUpperDelimiter(item.market_hash_name);
  }
  var leastWaxPrice = await findLeastWaxPrice(returnedItems)/1000;
  var buffLowerDelimiter = await getLowerDelimiter(item.market_hash_name) / 1000;
  var buffUpperDelimiter = await getUpperDelimiter(item.market_hash_name) / 1000;
  if(showResultDetail){
    console.log("------------");
    console.log("least price : ",leastWaxPrice);
    console.log("low limit : ",buffLowerDelimiter);
    console.log("high limit : ",buffUpperDelimiter);
    
  }

  if (leastWaxPrice < buffLowerDelimiter) {
    return buffLowerDelimiter;
  } else if (leastWaxPrice <= buffUpperDelimiter) {
    return leastWaxPrice - 0.001;
  } else {
    return buffUpperDelimiter;
  }
}

async function listMyItems() {
  if ((Date.now() - lastWaxNewListing) < hoursBetweenWaxNewListing * 60 * 60 * 1000) {
    return;
  }

  console.log("===> FETCHING YOUR LISTABLE ITEMS");

  lastWaxNewListing = Date.now();

  res = await axios.get(
    WAX_BASE_URL + "/my-inventory?key=" + waxPeerApiKey,
  );
  var setTime = Date.now();
  while (true) { if (Date.now() - setTime > 200) break; }

  if (res.status !== 200) {
    error();
    return;
  }

  var data = res.data;
  console.log(`Found ${data.items.length} listable items`);

  if (!data.items || data.items.length == 0) {
    return;
  }

  var failedNumber = 0;
  var addedNumber = 0;
  for (const item of data.items) {
    try {
      var price = await getWaxPriceFor(item);

      res = await axios.post(WAX_BASE_URL + `/add-to-sale?key=${waxPeerApiKey}&id=${item.id}&price=${Math.floor(price * 1000)}&cur=USD`);
      var setTime = Date.now();
      while (true) { if (Date.now() - setTime > 200) break; }

      if (showResultDetail) {
        console.log(`      name : ${item.market_hash_name}  price :  ${price}`)
      }

      if (res.data.success) { addedNumber++; }
    } catch {
      failedNumber++;
    }

  }
  console.log(`added  :  ${addedNumber}`);
  console.log(`failed :  ${failedNumber}`);
}


async function updateMyItems() {
  if ((Date.now() - lastWaxListingUpdate) < secondsBetweenWaxListingsUpdates * 1000) {
    return;
  }
  try {
    var res = await axios.get(
      WAX_BASE_URL + "/items",
      {
        params: {
          key: waxPeerApiKey,
        },
      }
    );
  } catch { return }

  var setTime = Date.now();
  while (true) { if (Date.now() - setTime > 200) break; }

  lastWaxListingUpdate = Date.now();
  // check if the request was successful
  if (res.status !== 200) {
    error();
    return;
  }
  // parse the response data
  myListedItems = res.data.items;
  console.log(`There are ${myListedItems.length} items for sale`);
  var updated = 0;
  // Create an array of Promises by mapping over the items and calling actLLAsync
  var totalNumber = 0;
  for (const item of myListedItems) {
    itemIdNamePair[item.item_id] = item.market_hash_name;
    try {
      var res = await axios.get(
        WAX_BASE_URL + `/search-item-by-hash-name`,
        {
          params: {
            hash_name: item.market_hash_name,
            key: waxPeerApiKey
          }
        }
      );
    } catch { continue; }
    var setTime = Date.now();
    while (true) { if (Date.now() - setTime > 200) break; }

    if (res.status === 200) {

      var itemName = item.market_hash_name;
      var returnedItems = res.data.data;
    //  console.log(returnedItems);
      var listedItemPriceInDollars = item.price * 1000;
      var leastWaxPrice = await findLeastWaxPrice(returnedItems);
      // console.log(leastWaxPrice,listedItemPriceInDollars)
      if (leastWaxPrice < listedItemPriceInDollars) {
        totalNumber++;
        var buffLowerDelimiter = await Math.round(getLowerDelimiter(itemName));
        var buffUpperDelimiter = await Math.round(getUpperDelimiter(itemName));

        if (leastWaxPrice < buffLowerDelimiter) {
          newItemPrice = buffLowerDelimiter;
        } else if (leastWaxPrice <= buffUpperDelimiter) {
          newItemPrice = leastWaxPrice - 1;
        } else {
          newItemPrice = buffUpperDelimiter;
        }
        if(newItemPrice!=listedItemPriceInDollars){
          try {
            var res = await axios.post(
              WAX_BASE_URL + `/set-price?key=${waxPeerApiKey}&item_id=${item.item_id}&price=${Math.round(newItemPrice)}&cur=USD`,
            );
          //  console.log(leastWaxPrice,listedItemPriceInDollars,buffLowerDelimiter,buffUpperDelimiter,newItemPrice);
            var setTime = Date.now();
            while (true) { if (Date.now() - setTime > 200) break; }
  
            if (res.status = 200) {
              if (res.data.success) {
                if (showResultDetail) {
  
                  console.log(`      name : ${item.market_hash_name} old price : ${listedItemPriceInDollars / 1000} new price :  ${newItemPrice / 1000}`)
  
                }
                updated++;
              }
            }
          } catch { }
        }
      }
    }
  }

  if (totalNumber > 0) {
    console.log(`Preparing new row of updates (${totalNumber} detected)`);

    if (updated > 0) {
      console.log(`   Success: ${updated}`);

    } else {
      console.log("   No success")
    }

    if (totalNumber - updated > 0) {
      console.log(`   Failed: ${totalNumber - updated}`);
    }
    else {
      console.log("   No failed");
    }
  }
  else {
    console.log("   ***No updates***");
  }
}

async function main() {
  await loadConfig();
  while (true) {
    try {
      await loadPriceMPIREInfo();
      await listMyItems();
      await updateMyItems();
    } catch {
      continue;
    }

  }
}

main();