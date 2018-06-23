var express = require('express')
  , app = express()
  , _ = require('underscore')
  , carriers = require('../lib/carriers.js')
  , crypto = require('crypto')
  , exec = require('child_process').exec
  , fs = require('fs')
  , path = require('path')
  , spawn = require('child_process').spawn
  , text = require('../lib/text');

// Express config
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

app.use(express.cookieParser());
app.use(express.static(__dirname + '/public'));
app.use(express.json());
app.use(express.urlencoded());
app.use(function(req, res, next) {
  // Enable CORS so sites can use the API directly in JS.
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Enable log messages when sending texts.
text.config({
  debugEnabled: true,
});

// Optional modules
var banned_numbers;
try {
  banned_numbers = require('./banned_numbers.js');
} catch(e) {
  banned_numbers = {BLACKLIST: {}};
}



var access_keys;
try {
  // Optionally, you may specify special access keys in a keys.json file.
  // These access keys are not rate-limited.
  // See example_keys.json for format.
  access_keys = require('./keys.json');
} catch (e) {
  access_keys = {};
}

// App routes
app.get('/', function(req, res) {
  fs.readFile(__dirname + '/views/index.html', 'utf8', function(err, text){
    res.send(text);
  });
});

app.get('/providers/:region', function(req, res) {
  // Utility function, just to check the providers currently loaded
  res.send(providers[req.params.region]);
});

app.post('/text', function(req, res) {
  console.log("got it");
  if (req.body.getcarriers != null && (req.body.getcarriers == 1 || req.body.getcarriers.toLowerCase() == 'true')) {
    res.send({success:true, carriers:Object.keys(carriers).sort()});
    return;
  }
  var number = stripPhone(req.body.number);
  if (number.length < 9 || number.length > 10) {
    res.send({success:false, message:'Invalid phone number.'});
    return;
  }
  textRequestHandler(req, res, number, req.body.carrier, 'us', req.query.key);
});

app.post('/canada', function(req, res) {
  textRequestHandler(req, res, stripPhone(req.body.number), req.body.carrier, 'canada', req.query.key);
});

app.post('/intl', function(req, res) {
  textRequestHandler(req, res, stripPhone(req.body.number), req.body.carrier, 'intl', req.query.key);
});

// App helper functions

function textRequestHandler(req, res, number, carrier, region, key) {
  var ip = req.connection.remoteAddress;
  if (!ip || ip === '127.0.0.1') {
    ip = req.header('X-Real-IP');
  }
  if (req.header('CF-Connecting-IP')) {
    ip = req.header('CF-Connecting-IP');
  }

  if (!number || !req.body.message) {
    res.send({success:false, message:'Number and message parameters are required.'});
    return;
  }
  if (carrier != null) {
    carrier = carrier.toLowerCase();
    if (carriers[carrier] == null) {
      res.send({success:false, message:'Carrier ' + carrier + ' not supported! POST getcarriers=1 to '
                                                               + 'get a list of supported carriers'});
      return;
    }
  }

  console.log("trying this");

  var message = req.body.message;
  if (message.indexOf(':') > -1) {
    // Handle problem with vtext where message would not get sent properly if it
    // contains a colon.
    message = ' ' + message;
  }

  var shasum = crypto.createHash('sha1');
  shasum.update(number);

  var tracking_details = {
    number: number,
    message: req.body.message,
    ip: ip,
    ip2: ip
  };

  if (banned_numbers.BLACKLIST[number]) {
    res.send({success:false,message:'Sorry, texts to this number are disabled.'});
    return;
  }

  var doSendText = function(response_obj) {
    response_obj = response_obj || {};

    // Time to actually send the message
    console.log("doing send text");
    text.send(number, message, carrier, region, function(err) {
      console.log("tried something");
      if (err) {
        res.send(_.extend(response_obj,
                          {
                            success:false,
                            message:'Communication with SMS gateway failed.'
                          }));
      }
      else {
        res.send(_.extend(response_obj, {success:true}));
      }
    });
  };

  // Do they have a valid access key?
  if (key && key in access_keys) {
    console.log('Got valid key', key, '... not applying limits.');
    // Skip verification
    doSendText({used_key: key});
    return;
  }
}           // end textRequestHandler

function dateStr() {
  var today = new Date();
  var dd = today.getDate();
  var mm = today.getMonth()+1;
  var yyyy = today.getFullYear();
  return mm + '/' + dd + '/' + yyyy;
}

function stripPhone(phone) {
  return (phone + '').replace(/\D/g, '');
}

// Start server
var port = process.env.PORT || 9090;
app.listen(port, function() {
  console.log('Listening on', port);
});
