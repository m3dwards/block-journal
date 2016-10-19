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
      throw new Error("Journal error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Journal error: contract binary not set. Can't deploy new instance.");
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

      throw new Error("Journal contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Journal: " + unlinked_libraries);
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
      throw new Error("Invalid address passed to Journal.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Journal not deployed or address not set.");
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
        "name": "_goalPost",
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
        "name": "numberOfReviewers",
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
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "name": "goalPost",
            "type": "uint256"
          }
        ],
        "name": "changeReviewRules",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "articleId",
            "type": "uint256"
          }
        ],
        "name": "attemptPublishOfArticle",
        "outputs": [
          {
            "name": "published",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "reviewTokenAddress",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "applyToBeAReviewer",
        "outputs": [
          {
            "name": "reviewerId",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "numberOfArticles",
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
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "reviewers",
        "outputs": [
          {
            "name": "reviewer",
            "type": "address"
          },
          {
            "name": "reputation",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "abstract",
            "type": "string"
          },
          {
            "name": "contents",
            "type": "string"
          },
          {
            "name": "doubleBlind",
            "type": "bool"
          }
        ],
        "name": "submitArticle",
        "outputs": [
          {
            "name": "articleId",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "articleId",
            "type": "uint256"
          },
          {
            "name": "inSupportOfPublishing",
            "type": "bool"
          }
        ],
        "name": "submitReview",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "randomNumber",
            "type": "uint256"
          }
        ],
        "name": "simpleSubmit",
        "outputs": [
          {
            "name": "articleId",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "articles",
        "outputs": [
          {
            "name": "author",
            "type": "address"
          },
          {
            "name": "abstract",
            "type": "string"
          },
          {
            "name": "contents",
            "type": "string"
          },
          {
            "name": "doubleBlind",
            "type": "bool"
          },
          {
            "name": "published",
            "type": "bool"
          },
          {
            "name": "numberOfReviews",
            "type": "uint256"
          }
        ],
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
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "name": "goalPost",
            "type": "uint256"
          }
        ],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticleAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "inSupportOfPublishing",
            "type": "bool"
          }
        ],
        "name": "ArticleReviewed",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticlePublished",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          }
        ],
        "name": "ReviewerAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "goalPost",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewTokenAddress",
            "type": "address"
          }
        ],
        "name": "ChangeOfRules",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604081815280610d13833960a090525160805160008054600160a060020a0319163317905560066003555050610cd88061003b6000396000f3606060405236156100ae5760e060020a600035046319a62c3081146100b05780631f2efcd1146100b957806321896c47146100c25780633475c1e7146100e75780634495d97614610171578063596f34731461018357806386e447a3146101e15780638da5cb5b146101ea5780639cc616f6146101fc578063ab929fcd14610270578063c11741a91461032f578063dc8d109514610361578063edcfafe61461037b578063f2fde38b146103d2575b005b61036960015481565b61036960065481565b6100ae600435602435600054600160a060020a03908116339091161461057857610002565b6103f360043560006000600060006000600260005086815481101561000257508152600786027f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace0193505b60058401548210156105f9576005840180548390811015610002576000918252602090912001805490915060ff16156106a957600192909201916106b2565b610407600754600160a060020a031681565b61036960058054600181018083556000928392918280158290116107025760020281600202836000526020600020918201910161070291905b808211156107db578054600160a060020a0319168155600060018201556002016101bc565b61036960035481565b610407600054600160a060020a031681565b61042460043560058054829081101561000257506000526002027f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db08101547f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db19190910154600160a060020a03919091169082565b6040805160206004803580820135601f8101849004840285018401909552848452610369949193602493909291840191908190840183828082843750506040805160208835808b0135601f8101839004830284018301909452838352979998604498929750919091019450909250829150840183828082843750949650509335935050505060028054600181018083556000928392918280158290116107df576007028160070283600052602060002091820191016107df91906108ac565b6100ae60043560243533600160a060020a0316600090815260046020526040812054819060ff161515610b5b57610002565b600460039081555b60408051918252519081900360200190f35b61044a600435600280548290811015610002579060005260206000209060070201600050805460038201546004830154600160a060020a0392909216935060018301926002019160ff828116926101009004169086565b6100ae60043560005433600160a060020a03908116911614610cc357610002565b604080519115158252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b6040518083600160a060020a031681526020018281526020019250505060405180910390f35b60408051600160a060020a03881681528415156060820152831515608082015260a0810183905260c060208201818152885460026001821615610100026000190190911604918301829052919283019060e0840190899080156104ee5780601f106104c3576101008083540402835291602001916104ee565b820191906000526020600020905b8154815290600101906020018083116104d157829003601f168201915b5050838103825287546002600182161561010002600019019091160480825260209190910190889080156105635780601f1061053857610100808354040283529160200191610563565b820191906000526020600020905b81548152906001019060200180831161054657829003601f168201915b50509850505050505050505060405180910390f35b60078054600160a060020a03191683179055600081141561059c57600180556105a2565b60018190555b60408051600754838252600160a060020a0316602082015281517fd71be580085eaba9d29fd2cb353c2933205a90eaf87c61b06963d55cab921195929181900390910190a15050565b600094505b50505050919050565b60015483106105eb5760038401805461ff001916610100908117909155604080518654898252600160a060020a03166020820181905260609282018381526001898101805460029281161590970260001901909616049383018490527fe093c6077bb5700c64e69276f3ee442638cebb6f053c60369185d95a454dffec948b94929390929091906080830190849080156106e95780601f106106be576101008083540402835291602001916106e9565b60001992909201915b60019190910190610132565b820191906000526020600020905b8154815290600101906020018083116106cc57829003601f168201915b505094505050505060405180910390a1600194506105f0565b5050600580549294509184915081101561000257505050600281027f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db081018054600160a060020a03191633908117825560017f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db1909301839055600160a060020a0316600081815260046020908152604091829020805460ff19168617905593850160065580519182525191927fa78fc22d4599bb0c6086d2af06bc1158a45e81f81994d0734c428ab181c1463f92918290030190a15090565b5090565b5050600280549294509184915081101561000257506000818152600784027f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace81018054600160a060020a0319163317815588517f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5acf92909201805481855260209485902092965090946001821615610100026000190190911604601f9081018490048201938a01908390106109bd57805160ff19168380011785555b506109ed92915061098b565b50506007015b808211156107db578054600160a060020a031916815560018181018054600080835592600290821615610100026000190190911604601f81901061097157505b5060028201600050805460018160011615610100020316600290046000825580601f1061099f57505b5060038201805461ffff1916905560006004830181905560058301805482825590825260209091206108a6918101905b808211156107db57805474ffffffffffffffffffffffffffffffffffffffffff19168155600101610945565b601f0160209004906000526020600020908101906108ec91905b808211156107db576000815560010161098b565b601f016020900490600052602060002090810190610915919061098b565b8280016001018555821561089a579182015b8281111561089a5782518260005055916020019190600101906109cf565b505083816002016000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610a4857805160ff19168380011785555b50610a7892915061098b565b82800160010185558215610a3c579182015b82811115610a3c578251826000505591602001919060010190610a5a565b50506003818101805460ff1916851761ff001916905560006004838101829055600185018355835460408051878152600160a060020a0392909216602083810182905260609284018381528c51938501939093528b517f09b7f9d23e699951618c3902a87a9a3be4af7642191c96d91887681703fc411c978a9793968e969594608087019488810194938493879385938893919291601f86019190910402600f01f150905090810190601f168015610b445780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a1509392505050565b60028054859081101561000257906000526020600020906007020160005033600160a060020a0316600090815260068201602052604090205490925060ff1615610ba457610002565b600482018054600190810190915533600160a060020a031660009081526006840160205260409020805460ff191682179055600583018054918201808255828015829011610c0357600083815260209020610c03918101908301610945565b50505090506040604051908101604052808481526020013381526020015082600501600050828154811015610002579060005260206000209001600050815181546020938401516101000260ff199190911690911774ffffffffffffffffffffffffffffffffffffffff0019161790556040805186815233600160a060020a03169281019290925284151582820152517f97f43e13a03e1a3be49d1a0107c3c65748342da009526ca4fe40c664ad56a4529181900360600190a150505050565b60008054600160a060020a031916821790555056",
    "events": {
      "0x09b7f9d23e699951618c3902a87a9a3be4af7642191c96d91887681703fc411c": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticleAdded",
        "type": "event"
      },
      "0x97f43e13a03e1a3be49d1a0107c3c65748342da009526ca4fe40c664ad56a452": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "inSupportOfPublishing",
            "type": "bool"
          }
        ],
        "name": "ArticleReviewed",
        "type": "event"
      },
      "0xe093c6077bb5700c64e69276f3ee442638cebb6f053c60369185d95a454dffec": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticlePublished",
        "type": "event"
      },
      "0xa78fc22d4599bb0c6086d2af06bc1158a45e81f81994d0734c428ab181c1463f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          }
        ],
        "name": "ReviewerAdded",
        "type": "event"
      },
      "0xd71be580085eaba9d29fd2cb353c2933205a90eaf87c61b06963d55cab921195": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "goalPost",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewTokenAddress",
            "type": "address"
          }
        ],
        "name": "ChangeOfRules",
        "type": "event"
      }
    },
    "updated_at": 1476892833146,
    "links": {},
    "address": "0x3f76af8f2645e872c90ff14418fc2524f5dd657f"
  },
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "_goalPost",
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
        "name": "numberOfReviewers",
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
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "name": "goalPost",
            "type": "uint256"
          }
        ],
        "name": "changeReviewRules",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "articleId",
            "type": "uint256"
          }
        ],
        "name": "attemptPublishOfArticle",
        "outputs": [
          {
            "name": "published",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "reviewTokenAddress",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "applyToBeAReviewer",
        "outputs": [
          {
            "name": "reviewerId",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "numberOfArticles",
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
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "reviewers",
        "outputs": [
          {
            "name": "reviewer",
            "type": "address"
          },
          {
            "name": "reputation",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "abstract",
            "type": "string"
          },
          {
            "name": "contents",
            "type": "string"
          },
          {
            "name": "doubleBlind",
            "type": "bool"
          }
        ],
        "name": "submitArticle",
        "outputs": [
          {
            "name": "articleId",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "articleId",
            "type": "uint256"
          },
          {
            "name": "inSupportOfPublishing",
            "type": "bool"
          }
        ],
        "name": "submitReview",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "randomNumber",
            "type": "uint256"
          }
        ],
        "name": "simpleSubmit",
        "outputs": [
          {
            "name": "articleId",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "articles",
        "outputs": [
          {
            "name": "author",
            "type": "address"
          },
          {
            "name": "abstract",
            "type": "string"
          },
          {
            "name": "contents",
            "type": "string"
          },
          {
            "name": "doubleBlind",
            "type": "bool"
          },
          {
            "name": "published",
            "type": "bool"
          },
          {
            "name": "numberOfReviews",
            "type": "uint256"
          }
        ],
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
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "name": "goalPost",
            "type": "uint256"
          }
        ],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticleAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "inSupportOfPublishing",
            "type": "bool"
          }
        ],
        "name": "ArticleReviewed",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticlePublished",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          }
        ],
        "name": "ReviewerAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "goalPost",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewTokenAddress",
            "type": "address"
          }
        ],
        "name": "ChangeOfRules",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604081815280610d13833960a090525160805160008054600160a060020a0319163317905560066003555050610cd88061003b6000396000f3606060405236156100ae5760e060020a600035046319a62c3081146100b05780631f2efcd1146100b957806321896c47146100c25780633475c1e7146100e75780634495d97614610171578063596f34731461018357806386e447a3146101e15780638da5cb5b146101ea5780639cc616f6146101fc578063ab929fcd14610270578063c11741a91461032f578063dc8d109514610361578063edcfafe61461037b578063f2fde38b146103d2575b005b61036960015481565b61036960065481565b6100ae600435602435600054600160a060020a03908116339091161461057857610002565b6103f360043560006000600060006000600260005086815481101561000257508152600786027f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace0193505b60058401548210156105f9576005840180548390811015610002576000918252602090912001805490915060ff16156106a957600192909201916106b2565b610407600754600160a060020a031681565b61036960058054600181018083556000928392918280158290116107025760020281600202836000526020600020918201910161070291905b808211156107db578054600160a060020a0319168155600060018201556002016101bc565b61036960035481565b610407600054600160a060020a031681565b61042460043560058054829081101561000257506000526002027f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db08101547f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db19190910154600160a060020a03919091169082565b6040805160206004803580820135601f8101849004840285018401909552848452610369949193602493909291840191908190840183828082843750506040805160208835808b0135601f8101839004830284018301909452838352979998604498929750919091019450909250829150840183828082843750949650509335935050505060028054600181018083556000928392918280158290116107df576007028160070283600052602060002091820191016107df91906108ac565b6100ae60043560243533600160a060020a0316600090815260046020526040812054819060ff161515610b5b57610002565b600460039081555b60408051918252519081900360200190f35b61044a600435600280548290811015610002579060005260206000209060070201600050805460038201546004830154600160a060020a0392909216935060018301926002019160ff828116926101009004169086565b6100ae60043560005433600160a060020a03908116911614610cc357610002565b604080519115158252519081900360200190f35b60408051600160a060020a03929092168252519081900360200190f35b6040518083600160a060020a031681526020018281526020019250505060405180910390f35b60408051600160a060020a03881681528415156060820152831515608082015260a0810183905260c060208201818152885460026001821615610100026000190190911604918301829052919283019060e0840190899080156104ee5780601f106104c3576101008083540402835291602001916104ee565b820191906000526020600020905b8154815290600101906020018083116104d157829003601f168201915b5050838103825287546002600182161561010002600019019091160480825260209190910190889080156105635780601f1061053857610100808354040283529160200191610563565b820191906000526020600020905b81548152906001019060200180831161054657829003601f168201915b50509850505050505050505060405180910390f35b60078054600160a060020a03191683179055600081141561059c57600180556105a2565b60018190555b60408051600754838252600160a060020a0316602082015281517fd71be580085eaba9d29fd2cb353c2933205a90eaf87c61b06963d55cab921195929181900390910190a15050565b600094505b50505050919050565b60015483106105eb5760038401805461ff001916610100908117909155604080518654898252600160a060020a03166020820181905260609282018381526001898101805460029281161590970260001901909616049383018490527fe093c6077bb5700c64e69276f3ee442638cebb6f053c60369185d95a454dffec948b94929390929091906080830190849080156106e95780601f106106be576101008083540402835291602001916106e9565b60001992909201915b60019190910190610132565b820191906000526020600020905b8154815290600101906020018083116106cc57829003601f168201915b505094505050505060405180910390a1600194506105f0565b5050600580549294509184915081101561000257505050600281027f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db081018054600160a060020a03191633908117825560017f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db1909301839055600160a060020a0316600081815260046020908152604091829020805460ff19168617905593850160065580519182525191927fa78fc22d4599bb0c6086d2af06bc1158a45e81f81994d0734c428ab181c1463f92918290030190a15090565b5090565b5050600280549294509184915081101561000257506000818152600784027f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace81018054600160a060020a0319163317815588517f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5acf92909201805481855260209485902092965090946001821615610100026000190190911604601f9081018490048201938a01908390106109bd57805160ff19168380011785555b506109ed92915061098b565b50506007015b808211156107db578054600160a060020a031916815560018181018054600080835592600290821615610100026000190190911604601f81901061097157505b5060028201600050805460018160011615610100020316600290046000825580601f1061099f57505b5060038201805461ffff1916905560006004830181905560058301805482825590825260209091206108a6918101905b808211156107db57805474ffffffffffffffffffffffffffffffffffffffffff19168155600101610945565b601f0160209004906000526020600020908101906108ec91905b808211156107db576000815560010161098b565b601f016020900490600052602060002090810190610915919061098b565b8280016001018555821561089a579182015b8281111561089a5782518260005055916020019190600101906109cf565b505083816002016000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610a4857805160ff19168380011785555b50610a7892915061098b565b82800160010185558215610a3c579182015b82811115610a3c578251826000505591602001919060010190610a5a565b50506003818101805460ff1916851761ff001916905560006004838101829055600185018355835460408051878152600160a060020a0392909216602083810182905260609284018381528c51938501939093528b517f09b7f9d23e699951618c3902a87a9a3be4af7642191c96d91887681703fc411c978a9793968e969594608087019488810194938493879385938893919291601f86019190910402600f01f150905090810190601f168015610b445780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a1509392505050565b60028054859081101561000257906000526020600020906007020160005033600160a060020a0316600090815260068201602052604090205490925060ff1615610ba457610002565b600482018054600190810190915533600160a060020a031660009081526006840160205260409020805460ff191682179055600583018054918201808255828015829011610c0357600083815260209020610c03918101908301610945565b50505090506040604051908101604052808481526020013381526020015082600501600050828154811015610002579060005260206000209001600050815181546020938401516101000260ff199190911690911774ffffffffffffffffffffffffffffffffffffffff0019161790556040805186815233600160a060020a03169281019290925284151582820152517f97f43e13a03e1a3be49d1a0107c3c65748342da009526ca4fe40c664ad56a4529181900360600190a150505050565b60008054600160a060020a031916821790555056",
    "events": {
      "0x09b7f9d23e699951618c3902a87a9a3be4af7642191c96d91887681703fc411c": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticleAdded",
        "type": "event"
      },
      "0x97f43e13a03e1a3be49d1a0107c3c65748342da009526ca4fe40c664ad56a452": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "inSupportOfPublishing",
            "type": "bool"
          }
        ],
        "name": "ArticleReviewed",
        "type": "event"
      },
      "0xe093c6077bb5700c64e69276f3ee442638cebb6f053c60369185d95a454dffec": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "articleId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "abstract",
            "type": "string"
          }
        ],
        "name": "ArticlePublished",
        "type": "event"
      },
      "0xa78fc22d4599bb0c6086d2af06bc1158a45e81f81994d0734c428ab181c1463f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "author",
            "type": "address"
          }
        ],
        "name": "ReviewerAdded",
        "type": "event"
      },
      "0xd71be580085eaba9d29fd2cb353c2933205a90eaf87c61b06963d55cab921195": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "goalPost",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reviewTokenAddress",
            "type": "address"
          }
        ],
        "name": "ChangeOfRules",
        "type": "event"
      }
    },
    "updated_at": 1476815168075,
    "links": {},
    "address": "0xdd43c5619bcd038f3b0f26d7d5ffb66ebdb6167f"
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

  Contract.contract_name   = Contract.prototype.contract_name   = "Journal";
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
    window.Journal = Contract;
  }
})();
