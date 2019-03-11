/*
    This file is part of web3.js.
    web3.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    web3.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.
    You should have received a copy of the GNU Lesser General Public License
    along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file TransactionObserver.js
 * @author Samuel Furter <samuel@ethereum.org>
 * @date 2019
 */

import {Observable} from 'rxjs';

export default class TransactionObserver {
    /**
     * @param {AbstractSocketProvider|HttpProvider|CustomProvider} provider
     * @param {Number} timeout
     * @param {Number} blockConfirmations
     * @param {GetTransactionReceiptMethod} getTransactionReceiptMethod
     * @param {GetBlockByHashMethod} getBlockByHashMethod
     * @param {NewHeadsSubscription} newHeadsSubscription
     *
     * @constructor
     */
    constructor(
        provider,
        timeout,
        blockConfirmations,
        getTransactionReceiptMethod,
        getBlockByHashMethod,
        newHeadsSubscription
    ) {
        this.provider = provider;
        this.timeout = timeout;
        this.blockConfirmations = blockConfirmations;
        this.getTransactionReceiptMethod = getTransactionReceiptMethod;
        this.getBlockByHashMethod = getBlockByHashMethod;
        this.newHeadsSubscription = newHeadsSubscription;

        this.blockNumbers = [];
        this.lastBlock = false;
        this.confirmations = 0;
        this.confirmationChecks = 0;
        this.observable = false;
        this.interval = false;
    }

    /**
     * Observes the transaction by the given transactionHash
     *
     * @method observe
     *
     * @param {String} transactionHash
     *
     * @returns {Observable}
     */
    observe(transactionHash) {
        this.observable = Observable.create((observer) => {
            if (this.isSocketBasedProvider()) {
                this.startSocketObserver(transactionHash, observer);
            } else {
                this.startHttpObserver(transactionHash, observer);
            }
        });

        return this.observable;
    }

    /**
     * TODO: Remove this method with changing the Web3 subscriptions interface to the tc39 interface and the usage of flatMap.
     *
     * @method stop
     *
     * Will unsubscribe anything.
     */
    stop() {
        if (this.isSocketBasedProvider()) {
            this.newHeadsSubscription.unsubscribe();
        } else {
            clearInterval(this.interval);
        }

        this.observable.unsubscribe();
    }

    /**
     * Observes the transaction with the newHeads subscriptions which sends the eth_getTransactionReceipt method on each item
     *
     * @method startSocketObserver
     *
     * @param {String} transactionHash
     * @param {Observer} observer
     */
    startSocketObserver(transactionHash, observer) {
        this.newHeadsSubscription.subscribe(async (newHeadError, newHead) => {
            try {
                if (newHeadError) {
                    throw newHeadError;
                }

                this.getTransactionReceiptMethod.parameters = [transactionHash];
                const receipt = await this.getTransactionReceiptMethod.execute();

                if (!this.blockNumbers.includes(newHead.number)) {
                    if (receipt) {
                        this.confirmations++;
                        this.emitNext(receipt, observer);

                        if (this.isConfirmed()) {
                            this.newHeadsSubscription.unsubscribe();
                            observer.complete();
                        }
                    }

                    this.blockNumbers.push(newHead.number);
                    this.confirmationChecks++;

                    if (this.isTimeoutTimeExceeded()) {
                        this.emitError(
                            new Error('Timeout exceeded during the transaction confirmation process. Be aware the transaction could still get confirmed!'),
                            receipt,
                            observer
                        );

                        this.newHeadsSubscription.unsubscribe();
                    }
                }
            } catch (error) {
                this.emitError(
                    error,
                    false,
                    observer
                );
            }
        });
    }

    /**
     * Observes the transaction with sending eth_getTransactionReceipt and checking if there is really a new block
     *
     * @method checkOverHttp
     *
     * @param {String} transactionHash
     * @param {Observer} observer
     */
    startHttpObserver(transactionHash, observer) {
        this.interval = setInterval(async () => {
            try {
                this.getTransactionReceiptMethod.parameters = [transactionHash];

                const receipt = await this.getTransactionReceiptMethod.execute();

                if (receipt) {
                    if (this.lastBlock) {
                        const block = await this.getBlockByHash(receipt.blockHash);
                        if (this.isValidConfirmation(block)) {
                            this.confirmations++;
                            this.emitNext(receipt, observer);
                            this.lastBlock = block;
                        }
                    } else {
                        this.lastBlock = await this.getBlockByHash(receipt.blockHash);
                        this.confirmations++;
                        this.emitNext(receipt, observer);
                    }

                    if (this.isConfirmed()) {
                        clearInterval(this.interval);
                        observer.complete();
                    }
                }

                this.confirmationChecks++;

                if (this.isTimeoutTimeExceeded()) {
                    clearInterval(this.interval);

                    this.emitError(
                        new Error('Timeout exceeded during the transaction confirmation process. Be aware the transaction could still get confirmed!'),
                        receipt,
                        observer
                    );
                }
            } catch (error) {
                clearInterval(this.interval);
                this.emitError(error, false, observer);
            }
        }, 1000);
    }

    /**
     * Calls the next callback method of the Observer
     *
     * @method emitNext
     *
     * @param {Object} receipt
     * @param {Observer} observer
     */
    emitNext(receipt, observer) {
        observer.next({receipt, confirmations: this.confirmations});
    }


    /**
     * Calls the error callback method of the Observer
     *
     * @method emitError
     *
     * @param {Error} error
     * @param {Object} receipt
     * @param {Observer} observer
     */
    emitError(error, receipt, observer) {
        observer.error(
            error,
            receipt,
            this.confirmations,
            this.confirmationChecks
        );
    }

    /**
     * Returns a block by the given blockHash
     *
     * @method getBlockByHash
     *
     * @param {String} blockHash
     *
     * @returns {Promise<Object>}
     */
    getBlockByHash(blockHash) {
        this.getBlockByHashMethod.parameters = [blockHash];

        return this.getBlockByHashMethod.execute();
    }

    /**
     * Checks if enough confirmations happened
     *
     * @method isConfirmed
     *
     *
     * @returns {Boolean}
     */
    isConfirmed() {
        return this.confirmations === this.blockConfirmations;
    }

    /**
     * Checks if the new block counts as confirmation
     *
     * @method isValidConfirmation
     *
     * @param {Object} block
     *
     * @returns {Boolean}
     */
    isValidConfirmation(block) {
        return this.lastBlock.hash === block.parentHash && this.lastBlock.number !== block.number;
    }

    /**
     * Checks if the timeout time is reached
     *
     * @method isTimeoutTimeExceeded
     *
     * @returns {Boolean}
     */
    isTimeoutTimeExceeded() {
        return this.confirmationChecks === this.timeout;
    }

    /**
     * Checks if the given provider is a socket based provider.
     *
     * @method isSocketBasedProvider
     *
     * @returns {Boolean}
     */
    isSocketBasedProvider() {
        switch (this.provider.constructor.name) {
            case 'CustomProvider':
            case 'HttpProvider':
                return false;
            default:
                return true;
        }
    }
}
