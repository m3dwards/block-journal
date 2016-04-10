define green
	@tput setaf 2
	@tput bold
	@echo $1
	@tput sgr0
endef

image_name = truffle-docker
mount_location = $(shell pwd)

.PHONEY: dev
dev:
	$(call green,"[Running dev container over current directory]")
	docker run --rm -it -v $(mount_location):/opt/src -w /opt/src $(image_name) /bin/bash


.PHONEY: docker-clean
docker-clean:
	@while [ -z "$$CONTINUE" ]; do \
		read -r -p "This will delete ALL docker containers on this host. Press 'y' to continue." CONTINUE; \
	done ; \
	[ $$CONTINUE = "y" ] || [ $$CONTINUE = "Y" ] || (echo "Exiting."; exit 1;)
	docker rm $$(docker ps -a -q) 

