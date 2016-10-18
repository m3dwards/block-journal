define green
	@tput setaf 2
	@tput bold
	@echo $1
	@tput sgr0
endef

image_name = truffle-docker
mount_location = $(shell pwd)
ip_address = $(shell ifconfig | sed -En 's/127.0.0.1//;s/.*inet (addr:)?(([0-9]*\.){3}[0-9]*).*/\2/p')

.PHONEY: dev
dev:
	$(call green,"[Running dev container over current directory]")
	docker run --rm -it -i -p 8080:8080 -p 8646:8646 -v $(mount_location):/opt/src -w /opt/src --name truffledev $(image_name) /bin/bash

.PHONEY: connect-dev
dev-connect:
	$(call green, "[Connecting to existing dev machine]")
	docker exec -it truffledev /bin/bash

.PHONEY: docker-clean
docker-clean:
	@while [ -z "$$CONTINUE" ]; do \
		read -r -p "This will delete ALL docker containers on this host. Press 'y' to continue." CONTINUE; \
	done ; \
	[ $$CONTINUE = "y" ] || [ $$CONTINUE = "Y" ] || (echo "Exiting."; exit 1;)
	docker rm $$(docker ps -a -q) 

.PHONEY: geth
geth:
	geth --rpc --rpcaddr "$(ip_address)" --unlock 0

.PHONEY: geth-morden
geth-morden:
	geth --fast --cache=1024 --password .gethpwd --testnet --rpc --rpcaddr "$(ip_address)" --unlock 0
