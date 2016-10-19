module.exports = {
  build: {
    "index.html": "index.html",
    "app.js": [
        "javascripts/file.js",
        "javascripts/app.js"
    ],
    "app.css": [
      "stylesheets/app.css"
    ],
    "images/": "images/"
  },
  rpc: {
    host: "localhost",
    port: 8646
  },
  networks: {
    "live": {
        network_id: 1, // Ethereum public network
        host: "localhost",
        port: 8646
    },
    "morden": {
        network_id: 2,
        host: "192.168.1.5",
        port: 8545
    },
    "staging": {
        network_id: 1337 // custom private network
        // use default rpc settings
        // optional config values
        // host - defaults to "localhost"
        // port - defaults to 8545
        // gas
        // gasPrice
        // from - default address to use for any transaction Truffle makes during migrations
    },
    "development": {
        network_id: "default"
    }
  }
};
