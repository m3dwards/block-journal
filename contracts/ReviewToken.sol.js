var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("ReviewToken error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("ReviewToken error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("ReviewToken contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of ReviewToken: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to ReviewToken.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: ReviewToken not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "2": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "name",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "mintedamount",
            "type": "uint256"
          }
        ],
        "name": "minttoken",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "newsellprice",
            "type": "uint256"
          },
          {
            "name": "newbuyprice",
            "type": "uint256"
          }
        ],
        "name": "setprices",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [
          {
            "name": "",
            "type": "uint8"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "balanceof",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "buyprice",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_value",
            "type": "uint256"
          }
        ],
        "name": "transferold",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_from",
            "type": "address"
          },
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_value",
            "type": "uint256"
          }
        ],
        "name": "transferfrom",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_spender",
            "type": "address"
          },
          {
            "name": "_value",
            "type": "uint256"
          }
        ],
        "name": "approveandcall",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "totalsupply",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "symbol",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "frozenaccount",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "buy",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "spentallowance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "sellprice",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "freeze",
            "type": "bool"
          }
        ],
        "name": "freezeaccount",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "allowance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "sell",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "initialsupply",
            "type": "uint256"
          },
          {
            "name": "tokenname",
            "type": "string"
          },
          {
            "name": "decimalunits",
            "type": "uint8"
          },
          {
            "name": "tokensymbol",
            "type": "string"
          },
          {
            "name": "centralminter",
            "type": "address"
          }
        ],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          }
        ],
        "name": "transfer",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "target",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "frozen",
            "type": "bool"
          }
        ],
        "name": "frozenfunds",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052604051610b09380380610b0983398101604052805160805160a05160c05160e0519394928301939192019060008054600160a060020a03191633179055600160a060020a0381166000146100655760008054600160a060020a031916331790555b600160a060020a033316600090815260076020908152604082208790556001805487519382905290927fb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6600261010084871615026000190190931692909204601f90810184900483019391929189019083901061010557805160ff19168380011785555b506101359291505b8082111561018e57600081556001016100f1565b828001600101855582156100e9579182015b828111156100e9578251826000505591602001919060010190610117565b50508160026000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061019257805160ff19168380011785555b506101c29291506100f1565b5090565b82800160010185558215610182579182015b828111156101825782518260005055916020019190600101906101a4565b50506003805460ff191693909317909255505050600655610922806101e76000396000f3606060405236156100f05760e060020a600035046306fdde0381146100f85780630c5fd4b2146101555780631f59653c1461017a578063313ce5671461019f5780633d64125b146101ab578063555413f7146101c35780635efbb728146101cc57806363b0545f146101fb5780636beadfc71461022d57806372dd529b146102d65780638da5cb5b146102df57806395d89b41146102f1578063981ade7b1461034e578063a6f2ae3a14610369578063b389199814610399578063bc094049146103be578063ce91e4b3146103c7578063dd62ed3e146103eb578063e4849b3214610410578063f2fde38b1461043c575b61045d610002565b60408051600180546020600282841615610100026000190190921691909104601f810182900482028401820190945283835261045f93908301828280156105515780601f1061052657610100808354040283529160200191610551565b61045d600435602435600054600160a060020a03908116339091161461055957610002565b61045d600435602435600054600160a060020a0390811633909116146105fa57610002565b6104cd60035460ff1681565b6104e360043560076020526000908152604090205481565b6104e360055481565b61045d60043560243533600160a060020a03166000908152600760205260409020548190101561060557610002565b6104f5600435602435604435600160a060020a038316600090815260076020526040812054829010156106ab57610002565b6104f560043560243533600160a060020a039081166000818152600960209081526040808320878616808552925280832086905580517fab40b65a000000000000000000000000000000000000000000000000000000008152600481019490945260248401869052309094166044840152925190928592909163ab40b65a916064808201928792909190829003018183876161da5a03f115610002575060019695505050505050565b6104e360065481565b610509600054600160a060020a031681565b61045f60028054604080516020601f600019600186161561010002019094168590049384018190048102820181019092528281529291908301828280156105515780601f1061052657610100808354040283529160200191610551565b6104f560043560086020526000908152604090205460ff1681565b60055430600160a060020a031660009081526007602052604090205461045d913404908190101561079657610002565b600a602090815260043560009081526040808220909252602435815220546104e39081565b6104e360045481565b61045d60043560243560005433600160a060020a039081169116146107f057610002565b6009602090815260043560009081526040808220909252602435815220546104e39081565b61045d60043533600160a060020a03166000908152600760205260409020548190101561085257610002565b61045d60043560005433600160a060020a039081169116146108e057610002565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156104bf5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b6040805160ff9092168252519081900360200190f35b60408051918252519081900360200190f35b604080519115158252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b820191906000526020600020905b81548152906001019060200180831161053457829003601f168201915b505050505081565b600160a060020a0382811660009081526007602090815260408083208054860190556006805486019055805183548682529151919094169360008051602061090283398151915292908290030190a381600160a060020a0316600060009054906101000a9004600160a060020a0316600160a060020a0316600080516020610902833981519152836040518082815260200191505060405180910390a35050565b600491909155600555565b600160a060020a038216600090815260076020526040902054808201101561062c57610002565b33600160a060020a031660009081526008602052604090205460ff161561065257610002565b600160a060020a0333811660008181526007602090815260408083208054879003905593861680835291849020805486019055835185815293519193600080516020610902833981519152929081900390910190a35050565b600160a060020a03831660009081526007602052604090205480830110156106d257610002565b600160a060020a0384811660008181526009602090815260408083203390951680845294825280832054938352600a825280832094835293905291909120548301111561071e57610002565b600160a060020a03848116600081815260076020908152604080832080548890039055878516808452818420805489019055848452600a835281842033909616845294825291829020805487019055815186815291516000805160206109028339815191529281900390910190a35060019392505050565b600160a060020a03338116600081815260076020908152604080832080548701905530909416808352918490208054869003905583518581529351929391926000805160206109028339815191529281900390910190a350565b600160a060020a038216600081815260086020908152604091829020805460ff19168517905581519283528315159083015280517f1d7db0d39a442104b2b0f0306f4e7efb80e3c2d44672b7ed602dae86338bba6b9281900390910190a15050565b30600160a060020a039081166000908152600760205260408082208054850190553390921680825282822080548590039055915160045484029082818181858883f1935050505015156108a457610002565b30600160a060020a031633600160a060020a0316600080516020610902833981519152836040518082815260200191505060405180910390a350565b6000805473ffffffffffffffffffffffffffffffffffffffff1916821790555056beabacc8ffedac16e9a60acdb2ca743d80c2ebb44977a93fa8e483c74d2b35a8",
    "events": {
      "0xbeabacc8ffedac16e9a60acdb2ca743d80c2ebb44977a93fa8e483c74d2b35a8": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          }
        ],
        "name": "transfer",
        "type": "event"
      },
      "0x1d7db0d39a442104b2b0f0306f4e7efb80e3c2d44672b7ed602dae86338bba6b": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "target",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "frozen",
            "type": "bool"
          }
        ],
        "name": "frozenfunds",
        "type": "event"
      }
    },
    "updated_at": 1476962774995,
    "links": {},
    "address": "0xd308bfac765a278bbc3653aa2b76c2e3943da66c"
  },
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "name",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "mintedamount",
            "type": "uint256"
          }
        ],
        "name": "minttoken",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "newsellprice",
            "type": "uint256"
          },
          {
            "name": "newbuyprice",
            "type": "uint256"
          }
        ],
        "name": "setprices",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [
          {
            "name": "",
            "type": "uint8"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "balanceof",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "buyprice",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_value",
            "type": "uint256"
          }
        ],
        "name": "transferold",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_from",
            "type": "address"
          },
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_value",
            "type": "uint256"
          }
        ],
        "name": "transferfrom",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_spender",
            "type": "address"
          },
          {
            "name": "_value",
            "type": "uint256"
          }
        ],
        "name": "approveandcall",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "totalsupply",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "symbol",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "frozenaccount",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "buy",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "spentallowance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "sellprice",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "freeze",
            "type": "bool"
          }
        ],
        "name": "freezeaccount",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "allowance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "sell",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "initialsupply",
            "type": "uint256"
          },
          {
            "name": "tokenname",
            "type": "string"
          },
          {
            "name": "decimalunits",
            "type": "uint8"
          },
          {
            "name": "tokensymbol",
            "type": "string"
          },
          {
            "name": "centralminter",
            "type": "address"
          }
        ],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          }
        ],
        "name": "transfer",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "target",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "frozen",
            "type": "bool"
          }
        ],
        "name": "frozenfunds",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052604051610b09380380610b0983398101604052805160805160a05160c05160e0519394928301939192019060008054600160a060020a03191633179055600160a060020a0381166000146100655760008054600160a060020a031916331790555b600160a060020a033316600090815260076020908152604082208790556001805487519382905290927fb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6600261010084871615026000190190931692909204601f90810184900483019391929189019083901061010557805160ff19168380011785555b506101359291505b8082111561018e57600081556001016100f1565b828001600101855582156100e9579182015b828111156100e9578251826000505591602001919060010190610117565b50508160026000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061019257805160ff19168380011785555b506101c29291506100f1565b5090565b82800160010185558215610182579182015b828111156101825782518260005055916020019190600101906101a4565b50506003805460ff191693909317909255505050600655610922806101e76000396000f3606060405236156100f05760e060020a600035046306fdde0381146100f85780630c5fd4b2146101555780631f59653c1461017a578063313ce5671461019f5780633d64125b146101ab578063555413f7146101c35780635efbb728146101cc57806363b0545f146101fb5780636beadfc71461022d57806372dd529b146102d65780638da5cb5b146102df57806395d89b41146102f1578063981ade7b1461034e578063a6f2ae3a14610369578063b389199814610399578063bc094049146103be578063ce91e4b3146103c7578063dd62ed3e146103eb578063e4849b3214610410578063f2fde38b1461043c575b61045d610002565b60408051600180546020600282841615610100026000190190921691909104601f810182900482028401820190945283835261045f93908301828280156105515780601f1061052657610100808354040283529160200191610551565b61045d600435602435600054600160a060020a03908116339091161461055957610002565b61045d600435602435600054600160a060020a0390811633909116146105fa57610002565b6104cd60035460ff1681565b6104e360043560076020526000908152604090205481565b6104e360055481565b61045d60043560243533600160a060020a03166000908152600760205260409020548190101561060557610002565b6104f5600435602435604435600160a060020a038316600090815260076020526040812054829010156106ab57610002565b6104f560043560243533600160a060020a039081166000818152600960209081526040808320878616808552925280832086905580517fab40b65a000000000000000000000000000000000000000000000000000000008152600481019490945260248401869052309094166044840152925190928592909163ab40b65a916064808201928792909190829003018183876161da5a03f115610002575060019695505050505050565b6104e360065481565b610509600054600160a060020a031681565b61045f60028054604080516020601f600019600186161561010002019094168590049384018190048102820181019092528281529291908301828280156105515780601f1061052657610100808354040283529160200191610551565b6104f560043560086020526000908152604090205460ff1681565b60055430600160a060020a031660009081526007602052604090205461045d913404908190101561079657610002565b600a602090815260043560009081526040808220909252602435815220546104e39081565b6104e360045481565b61045d60043560243560005433600160a060020a039081169116146107f057610002565b6009602090815260043560009081526040808220909252602435815220546104e39081565b61045d60043533600160a060020a03166000908152600760205260409020548190101561085257610002565b61045d60043560005433600160a060020a039081169116146108e057610002565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156104bf5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b6040805160ff9092168252519081900360200190f35b60408051918252519081900360200190f35b604080519115158252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b820191906000526020600020905b81548152906001019060200180831161053457829003601f168201915b505050505081565b600160a060020a0382811660009081526007602090815260408083208054860190556006805486019055805183548682529151919094169360008051602061090283398151915292908290030190a381600160a060020a0316600060009054906101000a9004600160a060020a0316600160a060020a0316600080516020610902833981519152836040518082815260200191505060405180910390a35050565b600491909155600555565b600160a060020a038216600090815260076020526040902054808201101561062c57610002565b33600160a060020a031660009081526008602052604090205460ff161561065257610002565b600160a060020a0333811660008181526007602090815260408083208054879003905593861680835291849020805486019055835185815293519193600080516020610902833981519152929081900390910190a35050565b600160a060020a03831660009081526007602052604090205480830110156106d257610002565b600160a060020a0384811660008181526009602090815260408083203390951680845294825280832054938352600a825280832094835293905291909120548301111561071e57610002565b600160a060020a03848116600081815260076020908152604080832080548890039055878516808452818420805489019055848452600a835281842033909616845294825291829020805487019055815186815291516000805160206109028339815191529281900390910190a35060019392505050565b600160a060020a03338116600081815260076020908152604080832080548701905530909416808352918490208054869003905583518581529351929391926000805160206109028339815191529281900390910190a350565b600160a060020a038216600081815260086020908152604091829020805460ff19168517905581519283528315159083015280517f1d7db0d39a442104b2b0f0306f4e7efb80e3c2d44672b7ed602dae86338bba6b9281900390910190a15050565b30600160a060020a039081166000908152600760205260408082208054850190553390921680825282822080548590039055915160045484029082818181858883f1935050505015156108a457610002565b30600160a060020a031633600160a060020a0316600080516020610902833981519152836040518082815260200191505060405180910390a350565b6000805473ffffffffffffffffffffffffffffffffffffffff1916821790555056beabacc8ffedac16e9a60acdb2ca743d80c2ebb44977a93fa8e483c74d2b35a8",
    "events": {
      "0xbeabacc8ffedac16e9a60acdb2ca743d80c2ebb44977a93fa8e483c74d2b35a8": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "from",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          }
        ],
        "name": "transfer",
        "type": "event"
      },
      "0x1d7db0d39a442104b2b0f0306f4e7efb80e3c2d44672b7ed602dae86338bba6b": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "target",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "frozen",
            "type": "bool"
          }
        ],
        "name": "frozenfunds",
        "type": "event"
      }
    },
    "updated_at": 1476815168087,
    "links": {},
    "address": "0x10b0e97c8ed3ef872bafb6119638fbb56893969f"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "ReviewToken";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.ReviewToken = Contract;
  }
})();
