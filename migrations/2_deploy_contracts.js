module.exports = function(deployer) {
    deployer.deploy(Owned)
    deployer.autolink();
    deployer.deploy(Journal);
    deployer.deploy(ReviewToken);
};

// module.exports = function(deployer, network) {
//     // Add demo data if we're not deploying to the live network.
//     if (network != "live") {
//         deployer.exec("add_demo_data.js");
//     }
// }

// deployer.then(function() {
//     // Create a new version of A
//     return A.new();
// }).then(function(instance) {
//     // Set the new instance of A's address on B.
//     var b = B.deployed();
//     return b.setA(instance.address);
// });
