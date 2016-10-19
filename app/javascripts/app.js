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

};

function submitArticle() {
    uploadFile();

    var journal = Journal.deployed();

    var description = document.getElementById("ShortDescription").value;
    var fullText = document.getElementById("FullText").value;
    var id = Math.floor(Math.random());

    setStatus("Submitting Article... (please wait)");

    journal.submitArticle(description, fullText, false, {from: account}).then(function() {
        setStatus("Article Submitted");
        return journal.numberOfArticles();
    }).catch(function(e) {
        console.log(e);
        setStatus("Problem submitting Article");
    }).then(function(value){
        showNumberOfArticles(value);
    }).catch(function(e) {
        console.log(e);
        setStatus("Problem getting number of articles");
    });
};

function getNumberOfArticles() {
    var journal = Journal.deployed();
    journal.numberOfArticles().then(function(value){
        showNumberOfArticles(value);
    });
}

function showNumberOfArticles(value) {
    document.getElementById("numberofarticles").innerHTML = value;
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

        getNumberOfArticles()
    });

    backendInit();
}
