var accounts;
var account;

function setStatus(message) {
  var status = document.getElementById("status");
  status.innerHTML = message;
};

function refreshBalance() {
    var journal = Journal.deployed();

    var balance = web3.fromWei(web3.eth.getBalance(account));

    setStatus("Account balance: " + balance + " ETH");


    // -  meta.getBalance.call(account, {from: account}).then(function(value) {
    //         -    var balance_element = document.getElementById("balance");
    //         -    balance_element.innerHTML = value.valueOf();
    //         -  }).catch(function(e) {
    //                 -    console.log(e);
    //                 -    setStatus("Error getting balance; see log.");
    //                 -  });
};

function submitArticle() {
    var journal = Journal.deployed();

    var description = document.getElementById("ShortDescription").value;
    var fullText = document.getElementById("FullText").value;
    var id = Math.floor(Math.random());
    
    setStatus("Submitting Article... (please wait)");

    journal.submitArticle(description, fullText, false, {from: account}).then(function() {
        setStatus("Article Submitted");
        showNumberOfArticles();
    }).catch(function(e) {
        console.log(e);
        setStatus("Problem submitting Article");
    });
};

function showNumberOfArticles() {
    var journal = Journal.deployed();

    journal.numberOfArticles().then(function(value){

        document.getElementById("numberofarticles").innerHTML = value;

    });

};

window.onload = function() {
    web3.eth.getAccounts(function(err, accs) {
    if (err != null) {
        alert("There was an error fetching your accounts.");
        return;
    }

    if (accs.length == 0) {
        alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
        return;
    }

    accounts = accs;
    account = accounts[0];

    refreshBalance();

    showNumberOfArticles()
  });
}
