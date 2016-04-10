# block-journal

## Install & Start (for OSX)

```bash
# install gmp
brew update && brew install gmp
# install meteor
curl https://install.meteor.com/ | sh
# install ethereum
brew tap ethereum/ethereum
brew install ethereum
# clone repo
git clone https://github.com/hitchcott/meteor-embark
# go to example app
cd meteor-embark/example
# start meteor
EMBARK_DEBUG=1 meteor
```
Once Meteor starts it will take a few seconds to start a blockchain and mine the demo contract.

Then go to http://localhost:3000 and play with the example app!

If app fails to start with message "can't connect to localhost:8101 check if an ethereum node is running" the problem could be that geth didn't start in time. Just changing a file with whitespace is usually enough to get it to start.
