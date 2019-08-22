import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { IonicPage, NavController, PopoverController, ViewController, ToastController } from 'ionic-angular';
import { ActiveDownloadsInterface } from './active-downloads.interface';
import { Observable, Subscription } from 'rxjs';
import { InteractSubtype, Environment, PageId, ActionButtonType, ImpressionType, InteractType } from '@app/service/telemetry-constants';
import {
  ContentDownloadRequest,
  DownloadEventType,
  DownloadProgress,
  DownloadRequest,
  DownloadService,
  EventNamespace,
  EventsBusService,
  StorageService,
  StorageDestination
} from 'sunbird-sdk';
import { SbPopoverComponent } from '@app/component';
import { AppHeaderService, CommonUtilService, TelemetryGeneratorService } from '@app/service';
import { SbNoNetworkPopupComponent } from '@app/component/popups/sb-no-network-popup/sb-no-network-popup';
import { FileSizePipe } from '@app/pipes/file-size/file-size';
import { SbInsufficientStoragePopupComponent } from '@app/component/popups/sb-insufficient-storage-popup/sb-insufficient-storage-popup';

@IonicPage()
@Component({
  selector: 'page-active-downloads',
  templateUrl: 'active-downloads.html',
})
export class ActiveDownloadsPage implements OnInit, OnDestroy, ActiveDownloadsInterface {

  downloadProgressMap: { [key: string]: number };
  activeDownloadRequests$: Observable<ContentDownloadRequest[]>;
  defaultImg = 'assets/imgs/ic_launcher.png';

  private _appHeaderSubscription?: Subscription;
  private _downloadProgressSubscription?: Subscription;
  private _networkSubscription?: Subscription;
  private _headerConfig = {
    showHeader: true,
    showBurgerMenu: false,
    actionButtons: [] as string[]
  };
  private _toast: any;
  private storageDestination: any;

  constructor(
    private popoverCtrl: PopoverController,
    private viewCtrl: ViewController,
    private changeDetectionRef: ChangeDetectorRef,
    private headerService: AppHeaderService,
    private navCtrl: NavController,
    private commonUtilService: CommonUtilService,
    private toastController: ToastController,
    private telemetryGeneratorService: TelemetryGeneratorService,
    private fileSizePipe: FileSizePipe,
    @Inject('DOWNLOAD_SERVICE') private downloadService: DownloadService,
    @Inject('EVENTS_BUS_SERVICE') private eventsBusService: EventsBusService,
    @Inject('STORAGE_SERVICE') private storageService: StorageService
  ) {
    this.downloadProgressMap = {};
    // @ts-ignore
    this.activeDownloadRequests$ = this.downloadService.getActiveDownloadRequests()
      .do(() => this.changeDetectionRef.detectChanges());
  }

  ngOnInit() {
    this.initDownloadProgress();
    this.initAppHeader();
    this.initNetworkDetection();
  }

  ngOnDestroy() {
    if (this._downloadProgressSubscription) {
      this._downloadProgressSubscription.unsubscribe();
    }
    if (this._appHeaderSubscription) {
      this._appHeaderSubscription.unsubscribe();
    }
    if (this._networkSubscription) {
      this._networkSubscription.unsubscribe();
      if (this._toast) {
        this._toast.dismiss();
        this._toast = undefined;
      }
    }
  }
  ionViewWillEnter() {
    this.fetchStorageDestination();
    this.checkAvailableSpace();
  }
  ionViewDidLoad() {
    this.telemetryGeneratorService.generatePageViewTelemetry(
      PageId.ACTIVE_DOWNLOADS,
      Environment.DOWNLOADS, '');
    //  this.checkAvailableSpace();
  }

  cancelAllDownloads(): void {
    this.telemetryGeneratorService.generateInteractTelemetry(
      InteractType.TOUCH,
      InteractSubtype.DOWNLOAD_CANCEL_ALL_CLICKED,
      Environment.DOWNLOADS,
      PageId.ACTIVE_DOWNLOADS);
    this.showCancelPopUp();
  }

  cancelDownload(downloadRequest: DownloadRequest): void {
    this.telemetryGeneratorService.generateInteractTelemetry(
      InteractType.TOUCH,
      InteractSubtype.DOWNLOAD_CANCEL_CLICKED,
      Environment.DOWNLOADS,
      PageId.ACTIVE_DOWNLOADS);
    this.showCancelPopUp(downloadRequest);
  }

  getContentDownloadProgress(contentId: string): number {
    return this.downloadProgressMap[contentId] && (this.downloadProgressMap[contentId] > -1) ? this.downloadProgressMap[contentId] : 0;
  }

  private initDownloadProgress(): void {
    // @ts-ignore
    this._downloadProgressSubscription = this.eventsBusService.events(EventNamespace.DOWNLOADS)
      .filter((event) => event.type === DownloadEventType.PROGRESS)
      .do((event) => {
        const downloadEvent = event as DownloadProgress;
        this.downloadProgressMap[downloadEvent.payload.identifier] = downloadEvent.payload.progress;
        this.changeDetectionRef.detectChanges();
      }).subscribe();
  }

  private initAppHeader() {
    this._appHeaderSubscription = this.headerService.headerEventEmitted$.subscribe(eventName => {
      this.handleHeaderEvents(eventName);
    });
    this._headerConfig = this.headerService.getDefaultPageConfig();
    this._headerConfig.actionButtons = [];
    this._headerConfig.showBurgerMenu = false;
    this.headerService.updatePageConfig(this._headerConfig);
  }

  private handleHeaderEvents(event: { name: string }) {
    switch (event.name) {
      case 'back':
        this.navCtrl.pop();
        break;
    }
  }

  private initNetworkDetection() {
    this._networkSubscription = this.commonUtilService.networkAvailability$.subscribe((available: boolean) => {
      if (available) {
        this.presentToast();
        if (this._toast) {
          this._toast.dismiss();
          this._toast = undefined;
        }
      } else {
        this.presentPopupForOffline();
      }
    });
  }

  private async presentToast() {
    const toast = await this.toastController.create({
      duration: 2000,
      message: this.commonUtilService.translateMessage('INTERNET_AVAILABLE'),
      showCloseButton: false,
      position: 'top',
      cssClass: 'toastForOnline'
    });
    toast.present();
  }

  private showCancelPopUp(downloadRequest?: DownloadRequest): void {
    this.telemetryGeneratorService.generatePageViewTelemetry(
      downloadRequest ? PageId.SINGLE_CANCEL_CONFIRMATION_POPUP : PageId.BULK_CANCEL_CONFIRMATION_POPUP,
      Environment.DOWNLOADS);
    const popupMessage = downloadRequest ? 'CANCEL_DOWNLOAD_MESSAGE' : 'CANCEL_ALL_DOWNLOAD_MESSAGE';
    const confirm = this.popoverCtrl.create(SbPopoverComponent, {
      sbPopoverHeading: this.commonUtilService.translateMessage('CANCEL_DOWNLOAD_TITLE'),
      sbPopoverMainTitle: this.commonUtilService.translateMessage(popupMessage),
      actionsButtons: [
        {
          btntext: this.commonUtilService.translateMessage('CANCEL_DOWNLOAD'),
          btnClass: 'popover-color'
        },
      ],
      icon: null,
      // metaInfo: this.content.contentData.name,
    }, {
        cssClass: 'sb-popover danger dw-active-downloads-popover',
      });

    confirm.present();

    const loader = this.commonUtilService.getLoader();

    confirm.onDidDismiss(async (canDelete: any) => {
      if (canDelete) {
        let valuesMap;
        if (downloadRequest) {
          valuesMap = {
            count: 1
          };
        } else {
          valuesMap = {
            count: (await this.activeDownloadRequests$.take(1).toPromise()).length
          };
        }
        this.telemetryGeneratorService.generateInteractTelemetry(
          InteractType.TOUCH,
          InteractSubtype.DOWNLOAD_CANCEL_CLICKED,
          Environment.DOWNLOADS,
          PageId.ACTIVE_DOWNLOADS, undefined, valuesMap);
        loader.present().then(() => {
          return downloadRequest ?
            this.downloadService.cancel(downloadRequest).toPromise() :
            this.downloadService.cancelAll().toPromise();
        }).then(() => {
          return loader.dismiss();
        });
      }
    });
  }

  private async presentPopupForOffline() {
    this._toast = this.popoverCtrl.create(SbNoNetworkPopupComponent, {
      sbPopoverHeading: this.commonUtilService.translateMessage('INTERNET_CONNECTIVITY_NEEDED'),
      sbPopoverMessage: this.commonUtilService.translateMessage('OFFLINE_DOWNLOAD_MESSAGE'),
    }, {
        cssClass: 'sb-popover no-network',
      });

    this._toast.present();
  }
  private async fetchStorageDestination() {
    this.storageDestination = await this.storageService.getStorageDestination().toPromise();
  }

  private async presentPopupForLessStorageSpace() {
    console.log('STORAGEDEST', this.storageDestination);
    this._toast = this.popoverCtrl.create(SbNoNetworkPopupComponent, {
    sbPopoverHeading: this.commonUtilService.translateMessage('INSUFFICIENT_STORAGE'),
    sbPopoverMessage: this.storageDestination === StorageDestination.INTERNAL_STORAGE ?
    this.commonUtilService.translateMessage('MOVE_FILES_TO_OTHER_DESTINATION', this.commonUtilService.translateMessage('SD_CARD')) :
    this.commonUtilService.translateMessage('MOVE_FILES_TO_OTHER_DESTINATION', this.commonUtilService.translateMessage(
      'INTERNAL_MEMORY'
    )),
    }, {
        cssClass: 'sb-popover no-network',
      });
    this._toast.present();
  }

  private checkAvailableSpace() {
   this.storageService.getStorageDestinationVolumeInfo()
   .do((volumeInfo) => {
    if (volumeInfo.info.availableSize < 209715200) {
      this.presentPopupForLessStorageSpace();
    }
   })
   .subscribe();
  }

}
